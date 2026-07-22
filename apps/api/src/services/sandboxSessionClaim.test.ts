import assert from "node:assert/strict";
import test from "node:test";
import {
  claimSandboxSession,
  type SandboxClaimInput,
  type SandboxOwnerRef,
  type SandboxSessionClaimStore,
} from "./sandboxSessionClaim.js";

/**
 * A provider switch means the next run on a conversation creates a *new*
 * sandbox and moves the pointer. `AgentSandbox.conversationId` and
 * `.threadId` are unique, so that has to be a compare-and-swap; two runs
 * arriving together must not both end up owning a sandbox.
 *
 * The store here is an in-memory stand-in for the transactional Prisma
 * implementation, with the same compare-and-swap contract.
 */

function ownerKey(owner: SandboxOwnerRef): string {
  if (owner.surface === "chat") return `chat:${owner.conversationId}`;
  if (owner.surface === "email") return `email:${owner.threadId}`;
  const scope =
    "conversationId" in owner.scope ? owner.scope.conversationId : owner.scope.emailThreadId;
  return `workflow:${scope}:${owner.agentId}`;
}

function fakeStore(initial: Record<string, string | null> = {}) {
  const pointers = new Map<string, string | null>(Object.entries(initial));
  const store: SandboxSessionClaimStore = {
    claim: (input: SandboxClaimInput) => {
      const key = ownerKey(input.owner);
      const current = pointers.get(key) ?? null;
      // The swap only applies while the slot still holds what the caller saw
      // (or is empty) — exactly the Prisma `updateMany` predicate.
      if (current !== null && current !== input.expectedSessionId) {
        return Promise.resolve({ claimed: false as const, currentSessionId: current });
      }
      pointers.set(key, input.sessionId);
      return Promise.resolve({ claimed: true as const });
    },
  };
  return { store, pointers };
}

const CHAT: SandboxOwnerRef = { surface: "chat", conversationId: "conv_1" };

function discarder() {
  const discarded: string[] = [];
  return {
    discarded,
    discard: (sessionId: string) => {
      discarded.push(sessionId);
      return Promise.resolve();
    },
  };
}

void test("a rotation onto the active provider takes the pointer", async () => {
  const { store, pointers } = fakeStore({ "chat:conv_1": "daytona:agent_1:sbx-old" });
  const cleanup = discarder();

  const result = await claimSandboxSession(
    { store, discard: cleanup.discard },
    {
      owner: CHAT,
      expectedSessionId: "daytona:agent_1:sbx-old",
      sessionId: "broker:agent_1:sbx-new",
    },
  );

  assert.deepEqual(result, { sessionId: "broker:agent_1:sbx-new", claimed: true });
  assert.equal(pointers.get("chat:conv_1"), "broker:agent_1:sbx-new");
  assert.deepEqual(cleanup.discarded, []);
});

void test("a first session claims an empty slot", async () => {
  const { store, pointers } = fakeStore();
  const cleanup = discarder();

  const result = await claimSandboxSession(
    { store, discard: cleanup.discard },
    { owner: CHAT, expectedSessionId: null, sessionId: "broker:agent_1:sbx-1" },
  );

  assert.equal(result.claimed, true);
  assert.equal(pointers.get("chat:conv_1"), "broker:agent_1:sbx-1");
});

void test("two concurrent rotations elect one winner and destroy the loser's sandbox", async () => {
  const { store, pointers } = fakeStore({ "chat:conv_1": "daytona:agent_1:sbx-old" });
  const cleanup = discarder();
  const deps = { store, discard: cleanup.discard };

  // Both runs read the same old pointer, both already created a sandbox.
  const [first, second] = await Promise.all([
    claimSandboxSession(deps, {
      owner: CHAT,
      expectedSessionId: "daytona:agent_1:sbx-old",
      sessionId: "broker:agent_1:sbx-a",
    }),
    claimSandboxSession(deps, {
      owner: CHAT,
      expectedSessionId: "daytona:agent_1:sbx-old",
      sessionId: "broker:agent_1:sbx-b",
    }),
  ]);

  const winners = [first, second].filter((r) => r.claimed);
  assert.equal(winners.length, 1, "exactly one run may own the pointer");

  const winningSessionId = winners[0]!.sessionId;
  assert.equal(pointers.get("chat:conv_1"), winningSessionId);

  // The loser adopts the winner's sandbox rather than running on its own.
  const loser = [first, second].find((r) => !r.claimed);
  assert.ok(loser);
  assert.equal(loser.sessionId, winningSessionId);

  // ...and its orphan is destroyed, not left running.
  assert.deepEqual(cleanup.discarded, [
    winningSessionId === "broker:agent_1:sbx-a"
      ? "broker:agent_1:sbx-b"
      : "broker:agent_1:sbx-a",
  ]);
});

void test("a failed cleanup does not fail the run", async () => {
  const { store } = fakeStore({ "chat:conv_1": "broker:agent_1:sbx-winner" });

  const result = await claimSandboxSession(
    {
      store,
      discard: () => Promise.reject(new Error("provider unreachable")),
    },
    {
      owner: CHAT,
      expectedSessionId: "daytona:agent_1:sbx-old",
      sessionId: "broker:agent_1:sbx-loser",
    },
  );

  // Reconciliation reaps the leftover; the turn still runs on the winner.
  assert.deepEqual(result, { sessionId: "broker:agent_1:sbx-winner", claimed: false });
});

void test("email threads and workflow slots follow the same rule", async () => {
  const { store, pointers } = fakeStore({
    "email:thread_1": "daytona:agent_1:sbx-old",
    "workflow:wconv_1:agent_1": "daytona:agent_1:sbx-wf-old",
  });
  const cleanup = discarder();
  const deps = { store, discard: cleanup.discard };

  const email = await claimSandboxSession(deps, {
    owner: { surface: "email", threadId: "thread_1" },
    expectedSessionId: "daytona:agent_1:sbx-old",
    sessionId: "broker:agent_1:sbx-new",
  });
  const workflow = await claimSandboxSession(deps, {
    owner: {
      surface: "workflow",
      agentId: "agent_1",
      scope: { conversationId: "wconv_1" },
    },
    expectedSessionId: "daytona:agent_1:sbx-wf-stale",
    sessionId: "broker:agent_1:sbx-wf-new",
  });

  assert.equal(email.claimed, true);
  assert.equal(pointers.get("email:thread_1"), "broker:agent_1:sbx-new");

  // The workflow mapping had already moved on, so this run stands down.
  assert.equal(workflow.claimed, false);
  assert.equal(workflow.sessionId, "daytona:agent_1:sbx-wf-old");
  assert.deepEqual(cleanup.discarded, ["broker:agent_1:sbx-wf-new"]);
});
