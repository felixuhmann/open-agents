import { AgentBackendError } from "../agent-backend/types.js";
import { log } from "../log.js";

/**
 * Binding a freshly created sandbox to the conversation, thread, or workflow
 * slot that asked for it.
 *
 * This is the step a provider switch makes dangerous. `AgentSandbox`
 * constrains `conversationId` and `threadId` to be unique and
 * `WorkflowAgentSession` constrains `(scope, agent)`, so a replacement
 * sandbox cannot simply be registered alongside the row it replaces — the
 * old row has to be unlinked and the pointer moved in the same breath.
 *
 * Two runs on the same conversation can reach that point concurrently (a
 * retry racing its original, two workflow steps starting together). Both
 * will have already created a real remote sandbox by then, so the rule is:
 * exactly one wins the pointer, and the loser's sandbox is destroyed rather
 * than left running and unreferenced.
 *
 * The store is injected: the claim itself is a compare-and-swap, and the
 * decision of what to do when it fails is worth testing without a database.
 */

export type WorkflowSessionScope = { conversationId: string } | { emailThreadId: string };

export type SandboxOwnerRef =
  | { surface: "chat"; conversationId: string }
  | { surface: "email"; threadId: string }
  | { surface: "workflow"; agentId: string; scope: WorkflowSessionScope };

export type SandboxClaimInput = {
  owner: SandboxOwnerRef;
  /**
   * Session id the caller saw on the owner before it created a replacement.
   * `null` means "the slot was empty". The swap only applies while the slot
   * still holds this value.
   */
  expectedSessionId: string | null;
  /** Session id of the sandbox that was just created. */
  sessionId: string;
};

export type SandboxClaimOutcome =
  | { claimed: true }
  /** Someone else moved the pointer first; this is where it points now. */
  | { claimed: false; currentSessionId: string };

export type SandboxSessionClaimStore = {
  claim(input: SandboxClaimInput): Promise<SandboxClaimOutcome>;
};

export type SandboxSessionClaimDeps = {
  store: SandboxSessionClaimStore;
  /** Destroy the remote sandbox behind a session id and retire its row. */
  discard: (sessionId: string) => Promise<void>;
};

export type SandboxSessionClaimResult = {
  /** Session the owner actually points at now. */
  sessionId: string;
  /** False when another run won the race and this run adopted its sandbox. */
  claimed: boolean;
};

export async function claimSandboxSession(
  deps: SandboxSessionClaimDeps,
  input: SandboxClaimInput,
): Promise<SandboxSessionClaimResult> {
  const outcome = await deps.store.claim(input);
  if (outcome.claimed) {
    return { sessionId: input.sessionId, claimed: true };
  }

  log.warn("sandboxes: lost the session pointer race, discarding the new sandbox", {
    ...input.owner,
    expectedSessionId: input.expectedSessionId,
    discardedSessionId: input.sessionId,
    winningSessionId: outcome.currentSessionId,
  });

  // Best effort: a sandbox we cannot reach right now is still recorded and
  // gets reaped by reconciliation. Failing the run over it would turn a
  // harmless race into a user-visible error.
  await deps.discard(input.sessionId).catch((err: unknown) => {
    log.error("sandboxes: failed to discard the superseded sandbox", {
      sessionId: input.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  });

  return { sessionId: outcome.currentSessionId, claimed: false };
}

/** Raised when the pointer keeps moving out from under repeated attempts. */
export function concurrentClaimError(owner: SandboxOwnerRef): AgentBackendError {
  return new AgentBackendError(
    `The sandbox session pointer for this ${owner.surface} kept changing concurrently. Retry the run.`,
    { status: 409 },
  );
}
