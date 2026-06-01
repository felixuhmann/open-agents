import type { Job } from "pg-boss";
import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import { getAgentById } from "../agents/service.js";
import { loadAgentForRun } from "../agents/snapshot.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { appendEvent } from "../runs/events.js";
import {
  redactToolArgs,
  summarizeToolResultForRunLog,
} from "../services/runObservability.js";
import { uploadPendingChatAttachments } from "../services/chatAttachments.js";
import { uploadPendingAttachments } from "../services/attachments.js";
import {
  resolveChatSessionId,
  resolveEmailSessionId,
  type ResolvedSession,
} from "../services/sessions.js";
import { buildRunUserMessage } from "../services/runUserMessage.js";
import { getBoss } from "./queue.js";
import {
  JOB_RUN_AGENT,
  JOB_SEND_EMAIL,
  type RunAgentJobData,
  type SendEmailJobData,
} from "./types.js";

export async function registerRunAgentWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<RunAgentJobData>(JOB_RUN_AGENT, async (jobs) => {
    for (const job of jobs) {
      await handleRunAgent(job);
    }
  });
  log.info("worker registered", { queue: JOB_RUN_AGENT });
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

  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "running" },
  });

  try {
    if (surface === "email") {
      await runEmailTurn(run.id, job.data);
    } else {
      await runChatTurn(run.id, job.data);
    }
    log.info("run-agent: done", { runId, durationMs: Date.now() - runStart });
  } catch (err) {
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
  }
}

async function runEmailTurn(runId: string, data: RunAgentJobData): Promise<void> {
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

  const backend = await getAgentBackend();
  const userMessage = buildRunUserMessage(backend, runId, incoming.body);

  const output = await streamRunWithEvents(runId, resolved.sessionId, userMessage, {
    runId,
    surface: "email",
    agentId: agent.id,
    agentVersionId: agent.agentVersionId,
    emailMessageId: data.emailMessageId,
  });

  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "succeeded", completedAt: new Date(), output },
  });
  await appendEvent({
    runId,
    type: "run.succeeded",
    payload: { type: "run.succeeded", output },
  });

  const sendJob: SendEmailJobData = {
    threadId: thread.id,
    runId,
    body:
      output.trim().length > 0
        ? output
        : "(The agent produced no textual output for this turn.)",
  };
  const boss = await getBoss();
  await boss.send(JOB_SEND_EMAIL, sendJob);
}

async function runChatTurn(runId: string, data: RunAgentJobData): Promise<void> {
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
      anthropicSessionId: conversation.anthropicSessionId,
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

  const backend = await getAgentBackend();
  const userMessage = buildRunUserMessage(backend, runId, message.content);

  const output = await streamRunWithEvents(runId, resolved.sessionId, userMessage, {
    runId,
    surface: "chat",
    agentId: agent.id,
    agentVersionId: agent.agentVersionId,
    chatMessageId: data.chatMessageId,
  });

  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "succeeded", completedAt: new Date(), output },
  });

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

async function appendRunStarted(runId: string, resolved: ResolvedSession): Promise<void> {
  await appendEvent({
    runId,
    type: "run.started",
    payload: {
      type: "run.started",
      runId,
      sessionId: resolved.sessionId,
      backend: resolved.providerSandboxId ? "daytona" : "anthropic",
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

/**
 * Stream the Anthropic SSE for one turn into RunEvent rows + NOTIFY.
 */
async function streamRunWithEvents(
  runId: string,
  sessionId: string,
  userMessage: string,
  context: {
    runId: string;
    surface: "chat" | "email";
    agentId: string;
    agentVersionId?: string;
    chatMessageId?: string;
    emailMessageId?: string;
  },
): Promise<string> {
  const backend = await getAgentBackend();
  return backend.streamUntilIdle(
    sessionId,
    userMessage,
    (event) => {
      if (event.kind === "delta") {
        void appendEvent({
          runId,
          type: "agent.delta",
          payload: {
            type: "agent.delta",
            text: event.text,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      } else if (event.kind === "message") {
        void appendEvent({
          runId,
          type: "agent.message",
          payload: {
            type: "agent.message",
            text: event.text,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      } else if (event.kind === "tool_use") {
        void appendEvent({
          runId,
          type: "tool.use",
          payload: {
            type: "tool.use",
            toolName: event.toolName,
            rawType: event.rawType,
            ...(event.callId ? { callId: event.callId } : {}),
            ...(event.args !== undefined ? { args: redactToolArgs(event.args) } : {}),
          },
        }).catch(() => undefined);
      } else if (event.kind === "tool_output") {
        void appendEvent({
          runId,
          type: "tool.output",
          payload: {
            type: "tool.output",
            toolName: event.toolName,
            stream: event.stream,
            text: event.text,
            rawType: event.rawType,
            ...(event.callId ? { callId: event.callId } : {}),
          },
        }).catch(() => undefined);
      } else if (event.kind === "tool_result") {
        void appendEvent({
          runId,
          type: "tool.result",
          payload: {
            type: "tool.result",
            toolName: event.toolName,
            rawType: event.rawType,
            ...(event.callId ? { callId: event.callId } : {}),
            ...(event.result !== undefined
              ? { result: summarizeToolResultForRunLog(event.result) }
              : {}),
            ...(event.isError !== undefined ? { isError: event.isError } : {}),
          },
        }).catch(() => undefined);
      } else if (event.kind === "model_request") {
        void appendEvent({
          runId,
          type: "model.request",
          payload: {
            type: "model.request",
            model: event.model,
            provider: event.provider,
            stopReason: event.stopReason,
            isError: event.isError,
            rawType: event.rawType,
            usage: event.usage,
          },
        }).catch(() => undefined);
      } else if (event.kind === "session_error") {
        void appendEvent({
          runId,
          type: "session.error",
          payload: {
            type: "session.error",
            message: event.message,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      }
    },
    context,
  );
}
