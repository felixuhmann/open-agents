import { Prisma } from "@open-agents/db";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { prisma } from "../db.js";
import { parsePiContext, serializePiContext } from "./piSessionContext.js";

type RunScope = {
  providerSessionId: string;
  previousWhere: Prisma.AgentRunWhereInput | null;
};

async function resolveRunScope(runId: string): Promise<RunScope> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      workflowStepRun: {
        include: { workflowRun: { select: { conversationId: true } } },
      },
    },
  });
  if (!run) throw new Error(`AgentRun not found: ${runId}`);

  const beforeCurrent: Prisma.AgentRunWhereInput = {
    id: { not: run.id },
    status: "succeeded",
    startedAt: { lte: run.startedAt },
    piContext: { not: Prisma.AnyNull },
  };

  if (run.conversationId) {
    return {
      providerSessionId: `chat:${run.conversationId}`,
      previousWhere: { ...beforeCurrent, conversationId: run.conversationId },
    };
  }
  if (run.threadId) {
    return {
      providerSessionId: `email:${run.threadId}`,
      previousWhere: { ...beforeCurrent, threadId: run.threadId },
    };
  }
  if (run.workflowStepRun) {
    const conversationId = run.workflowStepRun.workflowRun.conversationId;
    const position = run.workflowStepRun.position;
    return {
      providerSessionId: `workflow:${conversationId}:${position}`,
      previousWhere: {
        ...beforeCurrent,
        workflowStepRun: {
          position,
          workflowRun: { conversationId },
        },
      },
    };
  }

  // Delegated subagents are intentionally isolated per invocation. They receive
  // their parent-provided task as a fresh context and do not share a thread.
  return { providerSessionId: `run:${run.id}`, previousWhere: null };
}

/**
 * Load the latest durable Pi checkpoint for this conversation scope. A null
 * context tells the caller to use the legacy text transcript for pre-migration
 * conversations.
 */
export async function loadPiSessionCheckpoint(runId: string): Promise<{
  context: AgentMessage[] | null;
  providerSessionId: string;
}> {
  const scope = await resolveRunScope(runId);
  if (!scope.previousWhere) {
    return { context: null, providerSessionId: scope.providerSessionId };
  }

  const previous = await prisma.agentRun.findFirst({
    where: scope.previousWhere,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { piContext: true },
  });
  const context = previous?.piContext ? parsePiContext(previous.piContext) : null;
  return { context, providerSessionId: scope.providerSessionId };
}

/** Persist the replayable post-turn state only after Pi completed successfully. */
export async function savePiSessionCheckpoint(
  runId: string,
  messages: readonly AgentMessage[],
): Promise<void> {
  const piContext = serializePiContext(messages) as Prisma.InputJsonValue;
  await prisma.agentRun.update({
    where: { id: runId },
    data: { piContext },
  });
}
