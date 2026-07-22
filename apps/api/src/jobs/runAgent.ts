import type { Job } from "pg-boss";
import type { SessionResource } from "../agent-backend/types.js";
import { getAgentById } from "../agents/service.js";
import { config } from "../config.js";
import { loadAgentForRun } from "../agents/snapshot.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { appendEvent, subscribe } from "../runs/events.js";
import { streamRunWithEvents } from "../services/runStream.js";
import { uploadPendingChatAttachments } from "../services/chatAttachments.js";
import { uploadPendingAttachments } from "../services/attachments.js";
import {
  resolveChatSessionId,
  resolveEmailSessionId,
  type ResolvedSession,
} from "../services/sessions.js";
import { buildRunUserMessage } from "../services/runUserMessage.js";
import {
  finalizeAgentRunCancellation,
  isRunCancelledError,
  RunCancelledError,
} from "../services/runCancellation.js";
import { getBoss } from "./queue.js";
import {
  JOB_RUN_AGENT,
  JOB_SEND_EMAIL,
  type RunAgentJobData,
  type SendEmailJobData,
} from "./types.js";

export async function registerRunAgentWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<RunAgentJobData>(
    JOB_RUN_AGENT,
    { localConcurrency: config.AGENT_RUN_CONCURRENCY },
    async (jobs) => {
      for (const job of jobs) {
        await handleRunAgent(job);
      }
    },
  );
  log.info("worker registered", {
    queue: JOB_RUN_AGENT,
    localConcurrency: config.AGENT_RUN_CONCURRENCY,
  });
}

async function handleRunAgent(job: Job<RunAgentJobData>): Promise<void> {
  const { runId, surface } = job.data;
  const runStart = Date.now();
  log.info("run-agent: start", { jobId: job.id, runId, surface });

  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) {
    log.error("run-agent: run not found", { runId });
    throw new Error(`AgentRun not found: ${runId}`);
  }

  // pg-boss provides at-least-once delivery. A duplicate job must not invoke
  // the model again after all completion state was already persisted. The
  // event check also repairs runs affected by the old insert-then-NOTIFY race:
  // their success event exists even though the catch path changed the status.
  // Email enqueuing happens after that event, so only chat runs can safely use
  // the persisted event as proof that every required side effect completed.
  const persistedSuccess =
    run.status === "succeeded" || surface !== "chat"
      ? null
      : await prisma.runEvent.findFirst({
          where: { runId, type: "run.succeeded" },
          orderBy: { seq: "desc" },
          select: { seq: true },
        });
  if (run.status === "succeeded" || persistedSuccess) {
    if (run.status !== "succeeded") {
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: "succeeded", error: null },
      });
    }
    log.info("run-agent: already succeeded; skipping duplicate job", {
      jobId: job.id,
      runId,
      ...(persistedSuccess ? { successEventSeq: persistedSuccess.seq } : {}),
    });
    return;
  }

  if (run.status === "cancelled") {
    await finalizeAgentRunCancellation(runId);
    return;
  }
  if (run.status === "cancelling") {
    await finalizeAgentRunCancellation(runId);
    return;
  }

  const controller = new AbortController();
  const unsubscribe = subscribe(runId, (event) => {
    if (event.type === "run.cancel.requested" || event.type === "run.cancelled") {
      controller.abort();
    }
  });
  const cancellationPoll = setInterval(() => {
    void prisma.agentRun
      .findUnique({ where: { id: runId }, select: { status: true } })
      .then((current) => {
        if (current?.status === "cancelling" || current?.status === "cancelled") {
          controller.abort();
        }
      })
      .catch(() => undefined);
  }, 1_000);
  const claimed = await prisma.agentRun.updateMany({
    where: {
      id: runId,
      status: { notIn: ["succeeded", "cancelled", "cancelling"] },
    },
    data: { status: "running", startedAt: new Date(), completedAt: null, error: null },
  });
  if (claimed.count === 0) {
    clearInterval(cancellationPoll);
    unsubscribe();
    return;
  }

  try {
    if (surface === "email") {
      await runEmailTurn(run.id, job.data, controller.signal);
    } else {
      await runChatTurn(run.id, job.data, controller.signal);
    }
    log.info("run-agent: done", { runId, durationMs: Date.now() - runStart });
  } catch (err) {
    const latest = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (
      isRunCancelledError(err) ||
      controller.signal.aborted ||
      latest?.status === "cancelling" ||
      latest?.status === "cancelled"
    ) {
      const partialOutput = isRunCancelledError(err) ? err.partialOutput : "";
      await finalizeAgentRunCancellation(runId, partialOutput);
      log.info("run-agent: cancelled", {
        runId,
        durationMs: Date.now() - runStart,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error("run-agent: failed", {
      runId,
      durationMs: Date.now() - runStart,
      err: stack,
    });
    await prisma.agentRun
      .update({
        where: { id: runId },
        data: { status: "failed", completedAt: new Date(), error: message },
      })
      .catch((updateErr) => {
        log.warn("run-agent: failed to mark AgentRun failed", {
          runId,
          err: String(updateErr),
        });
      });
    await appendEvent({
      runId,
      type: "run.failed",
      payload: { type: "run.failed", error: message },
    }).catch(() => {
      // best-effort
    });
    throw err;
  } finally {
    clearInterval(cancellationPoll);
    unsubscribe();
  }
}

async function runEmailTurn(
  runId: string,
  data: RunAgentJobData,
  signal: AbortSignal,
): Promise<void> {
  if (!data.emailMessageId) {
    throw new Error("email surface requires emailMessageId");
  }
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run?.threadId) throw new Error("email run is missing threadId");

  const thread = await prisma.emailThread.findUnique({ where: { id: run.threadId } });
  if (!thread) throw new Error(`Thread not found: ${run.threadId}`);

  const baseAgent = await getAgentById(thread.agentId);
  if (!baseAgent) throw new Error(`Agent not found: ${thread.agentId}`);
  const agent = await loadAgentForRun(baseAgent, run.agentVersionId);

  const incoming = await prisma.emailMessage.findUnique({
    where: { id: data.emailMessageId },
  });
  if (!incoming) throw new Error(`Incoming message not found: ${data.emailMessageId}`);

  const newlyUploaded = await uploadPendingAttachments(data.emailMessageId);
  const hasNewAttachments = newlyUploaded.length > 0;
  const resources: SessionResource[] = newlyUploaded.map((f) => ({
    type: "file",
    fileId: f.id,
    mountPath: f.mountPath,
    filename: f.filename,
    mime: f.mime,
    bytes: f.bytes,
  }));

  const resolved = await resolveEmailSessionId(
    baseAgent,
    { id: thread.id, sessionId: thread.sessionId, subject: thread.subject },
    resources,
    hasNewAttachments,
    run.agentVersionId ?? undefined,
    runId,
  );
  await prisma.agentRun.update({
    where: { id: runId },
    data: { sessionId: resolved.sessionId },
  });
  await appendRunStarted(runId, resolved);

  const userMessage = buildRunUserMessage(incoming.body);

  const output = await streamRunWithEvents(runId, resolved.sessionId, userMessage, {
    runId,
    surface: "email",
    agentId: agent.id,
    agentVersionId: agent.agentVersionId,
    emailMessageId: data.emailMessageId,
    signal,
  });

  await markAgentRunSucceeded(runId, output);
  await appendEvent({
    runId,
    type: "run.succeeded",
    payload: { type: "run.succeeded", output },
  });

  const sendJob: SendEmailJobData = {
    threadId: thread.id,
    agentRunId: runId,
    body:
      output.trim().length > 0
        ? output
        : "(The agent produced no textual output for this turn.)",
  };
  const boss = await getBoss();
  await boss.send(JOB_SEND_EMAIL, sendJob);
}

async function runChatTurn(
  runId: string,
  data: RunAgentJobData,
  signal: AbortSignal,
): Promise<void> {
  if (!data.chatMessageId) {
    throw new Error("chat surface requires chatMessageId");
  }
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run?.conversationId) throw new Error("chat run is missing conversationId");

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: run.conversationId },
  });
  if (!conversation) throw new Error(`Conversation not found: ${run.conversationId}`);

  const baseAgent = await getAgentById(conversation.agentId);
  if (!baseAgent) throw new Error(`Agent not found: ${conversation.agentId}`);
  const agent = await loadAgentForRun(baseAgent, run.agentVersionId);

  const message = await prisma.chatMessage.findUnique({
    where: { id: data.chatMessageId },
  });
  if (!message) throw new Error(`Chat message not found: ${data.chatMessageId}`);

  const newlyUploaded = await uploadPendingChatAttachments(data.chatMessageId);
  const hasNewAttachments = newlyUploaded.length > 0;
  const resources: SessionResource[] = newlyUploaded.map((f) => ({
    type: "file",
    fileId: f.id,
    mountPath: f.mountPath,
    filename: f.filename,
    mime: f.mime,
    bytes: f.bytes,
  }));

  const resolved = await resolveChatSessionId(
    baseAgent,
    {
      id: conversation.id,
      sessionId: conversation.sessionId,
      title: conversation.title,
    },
    resources,
    hasNewAttachments,
    run.agentVersionId ?? undefined,
    runId,
  );
  await prisma.agentRun.update({
    where: { id: runId },
    data: { sessionId: resolved.sessionId },
  });
  await appendRunStarted(runId, resolved);

  const userMessage = buildRunUserMessage(message.content);

  const output = await streamRunWithEvents(runId, resolved.sessionId, userMessage, {
    runId,
    surface: "chat",
    agentId: agent.id,
    agentVersionId: agent.agentVersionId,
    chatMessageId: data.chatMessageId,
    signal,
  });

  await markAgentRunSucceeded(runId, output);

  if (output.trim().length > 0) {
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: output,
        runId,
      },
    });
  }

  await appendEvent({
    runId,
    type: "run.succeeded",
    payload: { type: "run.succeeded", output },
  });
}

async function markAgentRunSucceeded(runId: string, output: string): Promise<void> {
  const completed = await prisma.agentRun.updateMany({
    where: { id: runId, status: "running" },
    data: { status: "succeeded", completedAt: new Date(), output },
  });
  if (completed.count > 0) return;

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (run?.status === "cancelling" || run?.status === "cancelled") {
    throw new RunCancelledError(output);
  }
  throw new Error(`AgentRun ${runId} could not be completed from status ${run?.status}`);
}

async function appendRunStarted(runId: string, resolved: ResolvedSession): Promise<void> {
  await appendEvent({
    runId,
    type: "run.started",
    payload: {
      type: "run.started",
      runId,
      sessionId: resolved.sessionId,
      ...(resolved.provider ? { provider: resolved.provider } : {}),
      ...(resolved.providerSandboxId
        ? { providerSandboxId: resolved.providerSandboxId }
        : {}),
      ...(resolved.workspaceDir ? { workspaceDir: resolved.workspaceDir } : {}),
    },
  });
  if (resolved.skillsManifest?.entries.length) {
    await appendEvent({
      runId,
      type: "skills.materialized",
      payload: {
        type: "skills.materialized",
        skills: resolved.skillsManifest.entries,
      },
    });
  }
}
