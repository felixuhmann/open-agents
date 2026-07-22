import { Prisma } from "@open-agents/db";
import { prisma } from "../db.js";
import {
  concurrentClaimError,
  type SandboxClaimInput,
  type SandboxClaimOutcome,
  type SandboxOwnerRef,
  type SandboxSessionClaimStore,
} from "./sandboxSessionClaim.js";

/**
 * Prisma implementation of the session-pointer compare-and-swap.
 *
 * Under READ COMMITTED, Postgres re-checks an `UPDATE`'s `WHERE` against the
 * row version it actually locked, so a conditional `updateMany` is a real
 * compare-and-swap: a concurrent claim that already moved the pointer makes
 * this one match zero rows rather than silently overwriting it.
 *
 * Rebinding `AgentSandbox` happens in the same transaction as the pointer
 * move. `conversationId` and `threadId` are unique, so the row being
 * replaced must be unlinked before its successor can take the link — doing
 * that in two steps would leave a window where the admin sandbox view has no
 * row for the conversation, or two runs each think they own it.
 */

/** How many times to retry when the pointer is cleared mid-claim. */
const MAX_ATTEMPTS = 3;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export const prismaSandboxSessionClaimStore: SandboxSessionClaimStore = {
  async claim(input: SandboxClaimInput): Promise<SandboxClaimOutcome> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const outcome = await claimOnce(input);
      if (outcome) return outcome;
      // The slot was neither ours nor anyone else's by the time we looked:
      // it was cleared concurrently (sandbox deleted mid-run). Try again.
    }
    throw concurrentClaimError(input.owner);
  },
};

/** `null` means "contended but currently unowned" — the caller retries. */
async function claimOnce(input: SandboxClaimInput): Promise<SandboxClaimOutcome | null> {
  const { owner, expectedSessionId, sessionId } = input;

  if (owner.surface === "workflow") {
    return claimWorkflowSlot(owner, expectedSessionId, sessionId);
  }

  return prisma.$transaction(async (tx) => {
    const swapped =
      owner.surface === "chat"
        ? await tx.chatConversation.updateMany({
            where: {
              id: owner.conversationId,
              OR: [{ sessionId: expectedSessionId }, { sessionId: null }],
            },
            data: { sessionId },
          })
        : await tx.emailThread.updateMany({
            where: {
              id: owner.threadId,
              OR: [{ sessionId: expectedSessionId }, { sessionId: null }],
            },
            data: { sessionId },
          });

    if (swapped.count === 0) {
      const current =
        owner.surface === "chat"
          ? (
              await tx.chatConversation.findUnique({
                where: { id: owner.conversationId },
                select: { sessionId: true },
              })
            )?.sessionId
          : (
              await tx.emailThread.findUnique({
                where: { id: owner.threadId },
                select: { sessionId: true },
              })
            )?.sessionId;
      return current ? { claimed: false as const, currentSessionId: current } : null;
    }

    const link =
      owner.surface === "chat"
        ? { conversationId: owner.conversationId }
        : { threadId: owner.threadId };

    // Free the unique link from whichever row held it, then take it.
    await tx.agentSandbox.updateMany({
      where: { ...link, sessionId: { not: sessionId } },
      data: owner.surface === "chat" ? { conversationId: null } : { threadId: null },
    });
    await tx.agentSandbox.updateMany({
      where: { sessionId },
      data: { ...link, surface: owner.surface },
    });

    return { claimed: true as const };
  });
}

async function claimWorkflowSlot(
  owner: Extract<SandboxOwnerRef, { surface: "workflow" }>,
  expectedSessionId: string | null,
  sessionId: string,
): Promise<SandboxClaimOutcome | null> {
  const scope =
    "conversationId" in owner.scope
      ? { conversationId: owner.scope.conversationId }
      : { emailThreadId: owner.scope.emailThreadId };

  if (expectedSessionId === null) {
    try {
      await prisma.workflowAgentSession.create({
        data: { ...scope, agentId: owner.agentId, sessionId },
      });
      return { claimed: true };
    } catch (err) {
      // Another step created the mapping first; adopt its sandbox.
      if (!isUniqueViolation(err)) throw err;
      return readWorkflowSlot(owner, scope);
    }
  }

  const swapped = await prisma.workflowAgentSession.updateMany({
    where: { ...scope, agentId: owner.agentId, sessionId: expectedSessionId },
    data: { sessionId },
  });
  if (swapped.count > 0) return { claimed: true };

  return readWorkflowSlot(owner, scope);
}

async function readWorkflowSlot(
  owner: Extract<SandboxOwnerRef, { surface: "workflow" }>,
  scope: { conversationId: string } | { emailThreadId: string },
): Promise<SandboxClaimOutcome | null> {
  const current = await prisma.workflowAgentSession.findFirst({
    where: { ...scope, agentId: owner.agentId },
    select: { sessionId: true },
  });
  return current ? { claimed: false, currentSessionId: current.sessionId } : null;
}
