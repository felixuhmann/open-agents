import assert from "node:assert/strict";
import test from "node:test";
import {
  pickCurrentSandbox,
  toSandboxSummary,
  type SandboxRowWithRelations,
} from "./sandboxSummary.js";

/**
 * Characterization of the `AgentSandbox` → `SandboxSummaryDto` projection the
 * admin sandbox table and the MCP control plane consume. The row's own
 * `provider` column is authoritative and must survive the provider-neutral
 * refactor untouched.
 */

const CREATED_AT = new Date("2026-01-02T03:04:05.000Z");
const ACTIVITY_AT = new Date("2026-01-03T00:00:00.000Z");

function row(overrides: Partial<SandboxRowWithRelations> = {}): SandboxRowWithRelations {
  return {
    id: "sbx_row_1",
    provider: "daytona",
    providerSandboxId: "3f6b0e1c-0000-4000-8000-000000000001",
    sessionId: "daytona:agent_1:3f6b0e1c-0000-4000-8000-000000000001",
    state: "started",
    agentId: "agent_1",
    surface: "chat",
    conversationId: "conv_1",
    threadId: null,
    lifecyclePolicy: {
      autoStopInterval: 15,
      autoArchiveInterval: 10_080,
      autoDeleteInterval: -1,
    },
    lastActivityAt: ACTIVITY_AT,
    lastSyncedAt: null,
    errorReason: null,
    recoverable: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    agent: { slug: "researcher", displayName: "Researcher" },
    conversation: { title: "Weekly report" },
    thread: null,
    ...overrides,
  };
}

void test("summary projects the row's own provider and provider sandbox id", () => {
  const summary = toSandboxSummary(row());

  assert.equal(summary.provider, "daytona");
  assert.equal(summary.providerSandboxId, "3f6b0e1c-0000-4000-8000-000000000001");
  assert.equal(summary.sessionId, "daytona:agent_1:3f6b0e1c-0000-4000-8000-000000000001");
});

void test("non-Daytona rows project their own provider verbatim", () => {
  const summary = toSandboxSummary(
    row({ provider: "broker", sessionId: "broker:agent_1:sbx-42" }),
  );

  assert.equal(summary.provider, "broker");
  assert.equal(summary.sessionId, "broker:agent_1:sbx-42");
});

void test("summary joins agent, conversation, and thread labels", () => {
  const summary = toSandboxSummary(row());
  assert.equal(summary.agentSlug, "researcher");
  assert.equal(summary.agentDisplayName, "Researcher");
  assert.equal(summary.conversationTitle, "Weekly report");
  assert.equal(summary.threadSubject, null);

  const emailSummary = toSandboxSummary(
    row({
      surface: "email",
      conversationId: null,
      conversation: null,
      threadId: "thread_1",
      thread: { subject: "Invoice question" },
    }),
  );
  assert.equal(emailSummary.surface, "email");
  assert.equal(emailSummary.threadSubject, "Invoice question");
  assert.equal(emailSummary.conversationTitle, null);
});

void test("unknown surface values normalize to null rather than leaking through", () => {
  assert.equal(toSandboxSummary(row({ surface: "workflow" })).surface, null);
  assert.equal(toSandboxSummary(row({ surface: null })).surface, null);
});

void test("timestamps are ISO strings and optional ones stay nullable", () => {
  const summary = toSandboxSummary(row());
  assert.equal(summary.createdAt, "2026-01-02T03:04:05.000Z");
  assert.equal(summary.lastActivityAt, "2026-01-03T00:00:00.000Z");
  assert.equal(summary.lastSyncedAt, null);

  const synced = toSandboxSummary(row({ lastSyncedAt: CREATED_AT }));
  assert.equal(synced.lastSyncedAt, "2026-01-02T03:04:05.000Z");
});

void test("error state fields survive the projection", () => {
  const summary = toSandboxSummary(
    row({ state: "error", errorReason: "quota exceeded", recoverable: true }),
  );

  assert.equal(summary.state, "error");
  assert.equal(summary.errorReason, "quota exceeded");
  assert.equal(summary.recoverable, true);
});

// --------------------------------------------------- current-sandbox lookup

/**
 * After a Daytona → broker rotation the conversation points at its
 * replacement sandbox. Resolving "the sandbox for this conversation" by the
 * owner link alone can still surface the retired row, which would let an
 * operator stop or delete a sandbox the agent is not running on.
 */

function lookup(options: {
  ownerSessionId: string | null;
  rows: Record<string, string>;
  linked?: string;
}) {
  const calls: string[] = [];
  return {
    calls,
    run: () =>
      pickCurrentSandbox<string>({
        ownerSessionId: () => {
          calls.push("owner");
          return Promise.resolve(options.ownerSessionId);
        },
        bySessionId: (sessionId) => {
          calls.push(`session:${sessionId}`);
          return Promise.resolve(options.rows[sessionId] ?? null);
        },
        byOwnerLink: () => {
          calls.push("link");
          return Promise.resolve(options.linked ?? null);
        },
      }),
  };
}

void test("the row matching the owner's own session pointer wins after a rotation", async () => {
  const found = lookup({
    ownerSessionId: "broker:agent_1:sbx-new",
    rows: { "broker:agent_1:sbx-new": "row_new" },
    // The obsolete Daytona row is what an unordered owner-link query returns.
    linked: "row_old",
  });

  assert.equal(await found.run(), "row_new");
  assert.equal(found.calls.includes("link"), false);
});

void test("an owner with no pointer falls back to the linked row", async () => {
  const found = lookup({ ownerSessionId: null, rows: {}, linked: "row_backfilled" });

  assert.equal(await found.run(), "row_backfilled");
  assert.deepEqual(found.calls, ["owner", "link"]);
});

void test("a pointer with no sandbox row falls back rather than reporting nothing", async () => {
  const found = lookup({
    ownerSessionId: "daytona:agent_1:sbx-legacy",
    rows: {},
    linked: "row_legacy",
  });

  assert.equal(await found.run(), "row_legacy");
});

void test("no pointer and no link means there is no current sandbox", async () => {
  const found = lookup({ ownerSessionId: null, rows: {} });

  assert.equal(await found.run(), null);
});

void test("lifecycle policy is validated, not passed through blindly", () => {
  const summary = toSandboxSummary(row());
  assert.deepEqual(summary.lifecyclePolicy, {
    autoStopInterval: 15,
    autoArchiveInterval: 10_080,
    autoDeleteInterval: -1,
  });

  assert.throws(() =>
    toSandboxSummary(row({ lifecyclePolicy: { autoStopInterval: "soon" } })),
  );
});
