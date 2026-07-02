import { getAgentBackend } from "../agent-backend/instance.js";
import type { AgentRunContext } from "../agent-backend/types.js";
import { getAgentById } from "../agents/service.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { appendEvent } from "../runs/events.js";
import { streamRunWithEvents } from "./runStream.js";

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

/**
 * Execute one delegated subagent turn. Creates a fresh, isolated Daytona
 * session for the callee (pinned to its frozen version), records a child
 * `AgentRun` (surface = `subagent`, linked to the parent), streams the turn
 * into that run's own event log, and returns the final text to the caller.
 *
 * Guards (depth, cycle, per-run fan-out, published-version) fail soft: they
 * return an error result the model sees as a tool error rather than throwing,
 * so a bad delegation doesn't abort the whole parent run.
 */
export async function runSubagent(params: SubagentCallParams): Promise<SubagentCallResult> {
  const { parent, callee, prompt } = params;
  const childDepth = parent.depth + 1;

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

  const backend = await getAgentBackend();
  let session;
  try {
    session = await backend.createSession({
      agentId: base.id,
      agentSlug: base.slug,
      title: `subagent: ${base.slug}`,
      agentVersionId: callee.agentVersionId,
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
      backend: "daytona",
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
      },
    );
    await prisma.agentRun.update({
      where: { id: childRun.id },
      data: { status: "succeeded", completedAt: new Date(), output },
    });
    await appendEvent({
      runId: childRun.id,
      type: "run.succeeded",
      payload: { type: "run.succeeded", output },
    }).catch(() => undefined);
    return { ok: true, runId: childRun.id, output };
  } catch (err) {
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
    log.warn("subagent: run failed", {
      parentRunId: parent.runId,
      childRunId: childRun.id,
      subagent: callee.slug,
      err: message,
    });
    return { ok: false, runId: childRun.id, error: message };
  }
}
