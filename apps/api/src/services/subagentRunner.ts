import type { SubagentInnerEvent } from "@open-agents/types";
import { getAgentBackend } from "../agent-backend/instance.js";
import type {
  AgentEventHandler,
  AgentRunContext,
  AgentStreamEvent,
} from "../agent-backend/types.js";
import { getAgentById } from "../agents/service.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { appendEvent } from "../runs/events.js";
import { truncateText } from "./sandboxLimits.js";
import { summarizeToolResultForRunLog } from "./runObservability.js";
import {
  finalizeAgentRunCancellation,
  isRunCancelledError,
  RunCancelledError,
  throwIfRunCancelled,
} from "./runCancellation.js";
import { streamRunWithEvents } from "./runStream.js";
import { loadRunFileResources, materializeSubagentFiles } from "./subagentFiles.js";

/** Cap mirrored subagent text so nested activity doesn't bloat the parent log. */
const MIRROR_TEXT_CHARS = 2_000;

/**
 * Maximum delegation depth. A user-facing run is depth 0; the subagent it
 * spawns is depth 1, and so on. Bounds runaway recursion and cost.
 */
export const MAX_SUBAGENT_DEPTH = 4;

/** Maximum number of subagent calls a single run may make. */
export const MAX_SUBAGENT_CALLS_PER_RUN = 20;

export type SubagentCallParams = {
  parent: {
    runId: string;
    surface: AgentRunContext["surface"];
    /** Delegation depth of the CALLER. */
    depth: number;
    /** Agent ids from the delegation root down to the caller, inclusive. */
    ancestors: string[];
    /**
     * The parent's `run_subagent` tool-call id. When present, child-run
     * activity is mirrored onto the parent stream as `subagent.event`s keyed
     * to this id so the chat UI can nest it under the tool card.
     */
    toolCallId?: string;
    signal?: AbortSignal;
  };
  callee: {
    subagentId: string;
    slug: string;
    displayName: string;
    /** Pinned published version to run; null means the callee is unpublished. */
    agentVersionId: string | null;
  };
  prompt: string;
};

export type SubagentCallResult = {
  ok: boolean;
  runId?: string;
  output?: string;
  error?: string;
};

type MirrorController = {
  handler: AgentEventHandler;
  status: (status: "started" | "succeeded" | "failed" | "cancelled") => void;
};

function clip(text: string | undefined): string {
  return truncateText(text ?? "", MIRROR_TEXT_CHARS).text;
}

/**
 * Build a handler that forwards a child run's normalized events onto the
 * parent run's event log as `subagent.event`s, keyed to the parent's
 * `run_subagent` tool-call id so the chat UI can nest them under that card.
 * Deltas and model requests are intentionally dropped to keep the parent log
 * at tool-card granularity.
 */
function makeMirrorHandler(ctx: {
  parentRunId: string;
  childRunId: string;
  slug: string;
  toolCallId?: string;
}): MirrorController {
  const { parentRunId, childRunId, slug, toolCallId } = ctx;

  const emit = (inner: SubagentInnerEvent) => {
    if (!toolCallId) return;
    void appendEvent({
      runId: parentRunId,
      type: "subagent.event",
      payload: { type: "subagent.event", toolCallId, childRunId, slug, inner },
    }).catch(() => undefined);
  };

  return {
    status: (status) => emit({ kind: "run_status", status }),
    handler: (event: AgentStreamEvent) => {
      switch (event.kind) {
        case "message":
          emit({ kind: "message", text: clip(event.text) });
          break;
        case "tool_use":
          emit({ kind: "tool_use", toolName: event.toolName, callId: event.callId });
          break;
        case "tool_output":
          emit({
            kind: "tool_output",
            toolName: event.toolName,
            callId: event.callId,
            stream: event.stream,
            text: clip(event.text),
          });
          break;
        case "tool_result": {
          const summary = summarizeToolResultForRunLog(event.result);
          emit({
            kind: "tool_result",
            toolName: event.toolName,
            callId: event.callId,
            isError: event.isError,
            text: clip(typeof summary === "string" ? summary : JSON.stringify(summary)),
          });
          break;
        }
        case "session_error":
          emit({ kind: "session_error", text: clip(event.message) });
          break;
      }
    },
  };
}

/** Append a compact, model-readable list of returned files to the tool output. */
function appendFileSummary(
  output: string,
  files: Awaited<ReturnType<typeof materializeSubagentFiles>>,
): string {
  const lines = files.map(
    (f) =>
      `- ${f.filename} (${f.sizeBytes} bytes) — available in your sandbox at ${f.path}`,
  );
  return (
    `${output}\n\n---\nThis subagent produced ${files.length} file(s), now in your ` +
    `sandbox so you can read, reprocess, or forward them to another subagent. They ` +
    `are NOT shown to the user — to surface one, attach it yourself with ` +
    `attach_run_file:\n${lines.join("\n")}`
  );
}

/**
 * Execute one delegated subagent turn. Creates a fresh, isolated OpenSandbox
 * session for the callee (pinned to its frozen version), records a child
 * `AgentRun` (surface = `subagent`, linked to the parent), streams the turn
 * into that run's own event log, and returns the final text to the caller.
 *
 * Guards (depth, cycle, per-run fan-out, published-version) fail soft: they
 * return an error result the model sees as a tool error rather than throwing,
 * so a bad delegation doesn't abort the whole parent run.
 */
export async function runSubagent(
  params: SubagentCallParams,
): Promise<SubagentCallResult> {
  const { parent, callee, prompt } = params;
  const childDepth = parent.depth + 1;
  throwIfRunCancelled(parent.signal);

  if (childDepth > MAX_SUBAGENT_DEPTH) {
    return {
      ok: false,
      error: `Delegation depth limit (${MAX_SUBAGENT_DEPTH}) reached — cannot call another subagent from here.`,
    };
  }
  if (parent.ancestors.includes(callee.subagentId)) {
    return {
      ok: false,
      error: `Delegation cycle blocked: "${callee.slug}" is already running as an ancestor in this chain.`,
    };
  }
  if (!callee.agentVersionId) {
    return {
      ok: false,
      error: `Subagent "${callee.slug}" has no published version and cannot be called.`,
    };
  }

  const priorCalls = await prisma.agentRun.count({
    where: { parentRunId: parent.runId },
  });
  if (priorCalls >= MAX_SUBAGENT_CALLS_PER_RUN) {
    return {
      ok: false,
      error: `Subagent call limit (${MAX_SUBAGENT_CALLS_PER_RUN}) reached for this run.`,
    };
  }

  const base = await getAgentById(callee.subagentId);
  if (!base) {
    return { ok: false, error: `Subagent not found: ${callee.slug}` };
  }

  // Seed the child sandbox with the parent run's files so a subagent can pick
  // up artifacts an earlier subagent produced (the shared delegation "tray").
  const seededFiles = await loadRunFileResources(parent.runId).catch((err) => {
    log.warn("subagent: failed to load parent files for seeding", {
      parentRunId: parent.runId,
      subagent: callee.slug,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  });

  const backend = getAgentBackend();
  let session;
  try {
    session = await backend.createSession({
      agentId: base.id,
      agentSlug: base.slug,
      title: `subagent: ${base.slug}`,
      agentVersionId: callee.agentVersionId,
      ...(seededFiles.length > 0 ? { resources: seededFiles } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("subagent: session create failed", {
      parentRunId: parent.runId,
      subagent: callee.slug,
      err: message,
    });
    return { ok: false, error: `Failed to start subagent "${callee.slug}": ${message}` };
  }

  const childRun = await prisma.agentRun.create({
    data: {
      agentId: base.id,
      agentVersionId: callee.agentVersionId,
      surface: "subagent",
      parentRunId: parent.runId,
      sessionId: session.id,
      status: "running",
    },
  });

  await appendEvent({
    runId: childRun.id,
    type: "run.started",
    payload: {
      type: "run.started",
      runId: childRun.id,
      sessionId: session.id,
      backend: "opensandbox",
      ...(session.providerSandboxId
        ? { providerSandboxId: session.providerSandboxId }
        : {}),
      ...(session.workspaceDir ? { workspaceDir: session.workspaceDir } : {}),
    },
  }).catch(() => undefined);

  log.info("subagent: run started", {
    parentRunId: parent.runId,
    childRunId: childRun.id,
    subagent: callee.slug,
    depth: childDepth,
  });

  // Mirror the child's activity onto the parent stream so the chat UI can show
  // it live, nested under the parent's `run_subagent` tool card.
  const mirror = makeMirrorHandler({
    parentRunId: parent.runId,
    childRunId: childRun.id,
    slug: callee.slug,
    toolCallId: parent.toolCallId,
  });
  mirror.status("started");

  try {
    const output = await streamRunWithEvents(
      childRun.id,
      session.id,
      prompt,
      {
        runId: childRun.id,
        surface: "subagent",
        agentId: base.id,
        agentVersionId: callee.agentVersionId,
        delegationDepth: childDepth,
        delegationAncestors: [...parent.ancestors, base.id],
        parentRunId: parent.runId,
        signal: parent.signal,
      },
      mirror.handler,
    );

    // Place any files the subagent produced into the parent sandbox so the
    // orchestrator can read/reprocess/forward them. This does NOT surface them
    // to the user — only the orchestrator's own `attach_run_file` does that.
    const parentRun = await prisma.agentRun.findUnique({
      where: { id: parent.runId },
      select: { sessionId: true },
    });
    let files: Awaited<ReturnType<typeof materializeSubagentFiles>> = [];
    if (parentRun?.sessionId) {
      files = await materializeSubagentFiles({
        childRunId: childRun.id,
        parentRunId: parent.runId,
        parentSessionId: parentRun.sessionId,
        slug: callee.slug,
      }).catch((err) => {
        log.warn("subagent: file materialization failed", {
          parentRunId: parent.runId,
          childRunId: childRun.id,
          subagent: callee.slug,
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      });
    }

    const finalOutput = files.length > 0 ? appendFileSummary(output, files) : output;
    throwIfRunCancelled(parent.signal, finalOutput);
    const completed = await prisma.agentRun.updateMany({
      where: { id: childRun.id, status: "running" },
      data: { status: "succeeded", completedAt: new Date(), output: finalOutput },
    });
    if (completed.count === 0) throw new RunCancelledError(finalOutput);
    await appendEvent({
      runId: childRun.id,
      type: "run.succeeded",
      payload: { type: "run.succeeded", output: finalOutput },
    }).catch(() => undefined);
    mirror.status("succeeded");
    return { ok: true, runId: childRun.id, output: finalOutput };
  } catch (err) {
    if (isRunCancelledError(err) || parent.signal?.aborted) {
      await finalizeAgentRunCancellation(
        childRun.id,
        isRunCancelledError(err) ? err.partialOutput : "",
      );
      mirror.status("cancelled");
      throw isRunCancelledError(err) ? err : new RunCancelledError();
    }
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun
      .update({
        where: { id: childRun.id },
        data: { status: "failed", completedAt: new Date(), error: message },
      })
      .catch(() => undefined);
    await appendEvent({
      runId: childRun.id,
      type: "run.failed",
      payload: { type: "run.failed", error: message },
    }).catch(() => undefined);
    mirror.status("failed");
    log.warn("subagent: run failed", {
      parentRunId: parent.runId,
      childRunId: childRun.id,
      subagent: callee.slug,
      err: message,
    });
    return { ok: false, runId: childRun.id, error: message };
  }
}
