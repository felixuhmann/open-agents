import type { Job } from "pg-boss";
import type { WorkflowConfigSnapshot } from "@open-agents/types";
import type { SessionResource } from "../agent-backend/types.js";
import { getAgentById } from "../agents/service.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { appendEvent } from "../runs/events.js";
import { appendWorkflowEvent } from "../runs/workflowEvents.js";
import { redactToolArgs } from "../services/runObservability.js";
import {
  loadWorkflowUserUploadResources,
  uploadPendingWorkflowAttachments,
  uploadPendingWorkflowEmailAttachments,
  uploadedToSessionResources,
} from "../services/workflowAttachments.js";
import { buildRunUserMessage } from "../services/runUserMessage.js";
import { streamRunWithEvents } from "../services/runStream.js";
import { resolveWorkflowStepSession } from "../services/workflowSessions.js";
import { loadWorkflowSnapshotForRun } from "../workflows/snapshot.js";
import { getBoss } from "./queue.js";
import {
  JOB_RUN_WORKFLOW,
  JOB_SEND_EMAIL,
  type RunWorkflowJobData,
  type SendEmailJobData,
} from "./types.js";

class WorkflowStepError extends Error {
  constructor(
    public readonly position: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowStepError";
  }
}

export async function registerRunWorkflowWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<RunWorkflowJobData>(
    JOB_RUN_WORKFLOW,
    { localConcurrency: config.WORKFLOW_RUN_CONCURRENCY },
    async (jobs) => {
      for (const job of jobs) {
        await handleRunWorkflow(job);
      }
    },
  );
  log.info("worker registered", {
    queue: JOB_RUN_WORKFLOW,
    localConcurrency: config.WORKFLOW_RUN_CONCURRENCY,
  });
}

async function handleRunWorkflow(job: Job<RunWorkflowJobData>): Promise<void> {
  const { workflowRunId } = job.data;
  const start = Date.now();
  log.info("run-workflow: start", { jobId: job.id, workflowRunId });

  const run = await prisma.workflowRun.findUnique({ where: { id: workflowRunId } });
  if (!run) {
    log.error("run-workflow: run not found", { workflowRunId });
    return;
  }

  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { status: "running" },
  });

  try {
    await runPipeline(workflowRunId, job.data);
    log.info("run-workflow: done", { workflowRunId, durationMs: Date.now() - start });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const position = err instanceof WorkflowStepError ? err.position : null;
    log.error("run-workflow: failed", {
      workflowRunId,
      position,
      durationMs: Date.now() - start,
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    await prisma.workflowRun
      .update({
        where: { id: workflowRunId },
        data: { status: "failed", completedAt: new Date(), error: message },
      })
      .catch(() => undefined);
    // Emit terminal failure unless a per-step handler already did.
    const last = await prisma.workflowRunEvent.findFirst({
      where: { workflowRunId },
      orderBy: { seq: "desc" },
      select: { type: true },
    });
    if (last?.type !== "workflow.run.failed") {
      await appendWorkflowEvent({
        workflowRunId,
        type: "workflow.run.failed",
        payload: { type: "workflow.run.failed", position, error: message },
      }).catch(() => undefined);
    }
    // Intentionally not re-thrown: a workflow run has many side effects
    // (sandboxes, step rows, messages); auto-retry would re-run partially.
  }
}

async function runPipeline(
  workflowRunId: string,
  jobData: RunWorkflowJobData,
): Promise<void> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: { emailThread: true },
  });
  if (!run) throw new Error(`WorkflowRun not found: ${workflowRunId}`);

  const snapshot: WorkflowConfigSnapshot = await loadWorkflowSnapshotForRun(
    run.workflowId,
    run.workflowVersionId,
  );

  let userInput: string;
  let stepZeroUserResources: SessionResource[] = [];

  if (run.emailThreadId && jobData.workflowEmailMessageId) {
    const incoming = await prisma.workflowEmailMessage.findUnique({
      where: { id: jobData.workflowEmailMessageId },
    });
    if (!incoming) {
      throw new Error(
        `Workflow email message not found: ${jobData.workflowEmailMessageId}`,
      );
    }
    userInput = incoming.body;
    const uploaded = await uploadPendingWorkflowEmailAttachments(incoming.id);
    stepZeroUserResources = uploadedToSessionResources(uploaded);
  } else if (run.conversationId) {
    const lastUserMessage = await prisma.workflowMessage.findFirst({
      where: { conversationId: run.conversationId, role: "user" },
      orderBy: { createdAt: "desc" },
    });
    userInput = lastUserMessage?.content ?? "";
    if (lastUserMessage) {
      await uploadPendingWorkflowAttachments(lastUserMessage.id);
      stepZeroUserResources = await loadWorkflowUserUploadResources(run.conversationId);
    }
  } else {
    throw new Error(`WorkflowRun ${workflowRunId} has no conversation or email thread`);
  }

  await appendWorkflowEvent({
    workflowRunId,
    type: "workflow.run.started",
    payload: {
      type: "workflow.run.started",
      workflowRunId,
      steps: snapshot.steps.map((s) => ({
        position: s.position,
        agentSlug: s.agentSlug,
        agentDisplayName: s.agentDisplayName,
      })),
    },
  });

  let currentInput = userInput;
  let priorRunId: string | null = null;
  let lastOutput = "";
  let finalRunId: string | null = null;

  for (const step of snapshot.steps) {
    const baseAgent = await getAgentById(step.agentId);
    if (!baseAgent) {
      throw new WorkflowStepError(
        step.position,
        `Agent "${step.agentSlug}" referenced by this workflow no longer exists.`,
      );
    }

    const agentRun = await prisma.agentRun.create({
      data: {
        agentId: step.agentId,
        agentVersionId: step.agentVersionId,
        surface: "workflow",
        sessionId: "",
        status: "running",
      },
    });
    const stepRun = await prisma.workflowStepRun.create({
      data: {
        workflowRunId,
        position: step.position,
        agentId: step.agentId,
        agentSlug: step.agentSlug,
        agentVersionId: step.agentVersionId,
        runId: agentRun.id,
        status: "running",
        inputText: currentInput,
      },
    });

    await appendWorkflowEvent({
      workflowRunId,
      type: "workflow.step.started",
      payload: {
        type: "workflow.step.started",
        position: step.position,
        agentSlug: step.agentSlug,
        agentDisplayName: step.agentDisplayName,
        runId: agentRun.id,
      },
    });

    try {
      const resources = priorRunId
        ? await collectStepInputFiles(priorRunId)
        : step.position === 0
          ? stepZeroUserResources
          : ([] satisfies SessionResource[]);

      const sessionScope = run.conversationId
        ? { conversationId: run.conversationId }
        : run.emailThreadId
          ? { emailThreadId: run.emailThreadId }
          : null;
      if (!sessionScope) {
        throw new Error(
          `WorkflowRun ${workflowRunId} has no conversation or email thread`,
        );
      }

      const resolved = await resolveWorkflowStepSession(
        { id: baseAgent.id, slug: baseAgent.slug },
        sessionScope,
        step.agentVersionId,
        resources,
        agentRun.id,
      );
      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: { sessionId: resolved.sessionId },
      });
      await appendEvent({
        runId: agentRun.id,
        type: "run.started",
        payload: {
          type: "run.started",
          runId: agentRun.id,
          sessionId: resolved.sessionId,
          backend: "daytona",
          ...(resolved.providerSandboxId
            ? { providerSandboxId: resolved.providerSandboxId }
            : {}),
          ...(resolved.workspaceDir ? { workspaceDir: resolved.workspaceDir } : {}),
        },
      });

      const fileHint =
        step.position === 0 && resources.length > 0 && !priorRunId
          ? "user_upload"
          : "previous_step";
      const userMessage = buildStepUserMessage(currentInput, resources, fileHint);
      const output = await streamRunWithEvents(
        agentRun.id,
        resolved.sessionId,
        userMessage,
        {
          runId: agentRun.id,
          surface: "workflow",
          agentId: step.agentId,
          agentVersionId: step.agentVersionId,
        },
        (event) => {
          if (event.kind === "delta") {
            void appendWorkflowEvent({
              workflowRunId,
              type: "workflow.step.delta",
              payload: {
                type: "workflow.step.delta",
                position: step.position,
                text: event.text,
              },
            }).catch(() => undefined);
          } else if (event.kind === "tool_use" || event.kind === "tool_result") {
            void appendWorkflowEvent({
              workflowRunId,
              type: "workflow.step.tool",
              payload: {
                type: "workflow.step.tool",
                position: step.position,
                toolName: event.toolName,
                status: event.kind === "tool_use" ? "start" : "end",
                ...(event.kind === "tool_use" && event.args !== undefined
                  ? { args: redactToolArgs(event.args) }
                  : {}),
              },
            }).catch(() => undefined);
          }
        },
      );

      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: { status: "succeeded", completedAt: new Date(), output },
      });
      await appendEvent({
        runId: agentRun.id,
        type: "run.succeeded",
        payload: { type: "run.succeeded", output },
      });
      await prisma.workflowStepRun.update({
        where: { id: stepRun.id },
        data: { status: "succeeded", output },
      });

      const attachments = await prisma.agentAttachment.findMany({
        where: { runId: agentRun.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, filename: true, contentType: true, sizeBytes: true },
      });
      await appendWorkflowEvent({
        workflowRunId,
        type: "workflow.step.succeeded",
        payload: {
          type: "workflow.step.succeeded",
          position: step.position,
          runId: agentRun.id,
          output,
          attachments,
        },
      });

      currentInput = output;
      priorRunId = agentRun.id;
      lastOutput = output;
      finalRunId = agentRun.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.agentRun
        .update({
          where: { id: agentRun.id },
          data: { status: "failed", completedAt: new Date(), error: message },
        })
        .catch(() => undefined);
      await appendEvent({
        runId: agentRun.id,
        type: "run.failed",
        payload: { type: "run.failed", error: message },
      }).catch(() => undefined);
      await prisma.workflowStepRun
        .update({ where: { id: stepRun.id }, data: { status: "failed", error: message } })
        .catch(() => undefined);
      throw new WorkflowStepError(step.position, message);
    }
  }

  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { status: "succeeded", completedAt: new Date(), output: lastOutput },
  });

  if (run.conversationId && lastOutput.trim().length > 0) {
    await prisma.workflowMessage.create({
      data: {
        conversationId: run.conversationId,
        role: "assistant",
        content: lastOutput,
        workflowRunId,
        agentRunId: finalRunId,
      },
    });
  }

  await appendWorkflowEvent({
    workflowRunId,
    type: "workflow.run.succeeded",
    payload: { type: "workflow.run.succeeded", output: lastOutput, finalRunId },
  });

  if (run.emailThreadId && finalRunId) {
    const sendJob: SendEmailJobData = {
      workflowThreadId: run.emailThreadId,
      agentRunId: finalRunId,
      body:
        lastOutput.trim().length > 0
          ? lastOutput
          : "(The workflow produced no textual output for this turn.)",
    };
    const boss = await getBoss();
    await boss.send(JOB_SEND_EMAIL, sendJob);
  }
}

/** Pull the prior step's produced files and mount them under `inputs/`. */
async function collectStepInputFiles(priorRunId: string): Promise<SessionResource[]> {
  const rows = await prisma.agentAttachment.findMany({
    where: { runId: priorRunId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    type: "file" as const,
    fileId: row.id,
    mountPath: `inputs/${row.filename}`,
    filename: row.filename,
    mime: row.contentType,
    bytes: new Uint8Array(row.bytes),
  }));
}

function buildStepUserMessage(
  inputText: string,
  resources: SessionResource[],
  fileHint: "previous_step" | "user_upload",
): string {
  const text =
    inputText.trim().length > 0
      ? inputText
      : fileHint === "user_upload"
        ? "(no message text)"
        : "(no text from the previous step)";
  if (resources.length === 0) return buildRunUserMessage(text);
  const fileList = resources.map((r) => `- ${r.mountPath}`).join("\n");
  const label =
    fileHint === "user_upload"
      ? "Files attached to this request are mounted in this sandbox:"
      : "Files produced by the previous workflow step are mounted in this sandbox:";
  const withFiles = [text, "", label, fileList].join("\n");
  return buildRunUserMessage(withFiles);
}
