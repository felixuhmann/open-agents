import assert from "node:assert/strict";
import test from "node:test";
import { AgentBackendError } from "../agent-backend/types.js";
import {
  buildSandboxSessionId,
  parseSandboxSessionId,
  tryParseSandboxSessionId,
} from "./sessionId.js";

/**
 * Session ids are persisted on `ChatConversation`, `EmailThread`,
 * `WorkflowAgentSession`, `AgentSandbox`, and `AgentRun`. Every id ever
 * written by this deployment is `daytona:{agentId}:{providerSandboxId}`, so
 * the generic codec must parse those byte-for-byte and keep emitting the
 * identical string for Daytona.
 */

const LEGACY_AGENT_ID = "cmg4x0k2h0000v1abcdefghij";
const LEGACY_SANDBOX_ID = "3f6b0e1c-0000-4000-8000-000000000001";
const LEGACY_SESSION_ID = `daytona:${LEGACY_AGENT_ID}:${LEGACY_SANDBOX_ID}`;

void test("legacy Daytona session ids parse with an explicit provider", () => {
  const ref = parseSandboxSessionId(LEGACY_SESSION_ID);

  assert.deepEqual(ref, {
    provider: "daytona",
    agentId: LEGACY_AGENT_ID,
    providerSandboxId: LEGACY_SANDBOX_ID,
  });
});

void test("building a Daytona session id reproduces the persisted format exactly", () => {
  assert.equal(
    buildSandboxSessionId("daytona", LEGACY_AGENT_ID, LEGACY_SANDBOX_ID),
    LEGACY_SESSION_ID,
  );
  assert.equal(
    buildSandboxSessionId("daytona", LEGACY_AGENT_ID, LEGACY_SANDBOX_ID),
    `daytona:${LEGACY_AGENT_ID}:${LEGACY_SANDBOX_ID}`,
  );
});

void test("round-tripping any provider preserves all three components", () => {
  for (const provider of ["daytona", "broker"] as const) {
    const id = buildSandboxSessionId(provider, "agent_1", "sbx-42");
    assert.equal(id, `${provider}:agent_1:sbx-42`);
    assert.deepEqual(parseSandboxSessionId(id), {
      provider,
      agentId: "agent_1",
      providerSandboxId: "sbx-42",
    });
  }
});

void test("unknown providers are rejected instead of defaulting to Daytona", () => {
  assert.throws(
    () => parseSandboxSessionId("modal:agent_1:sbx-1"),
    (err: unknown) =>
      err instanceof AgentBackendError && err.message.includes("modal:agent_1:sbx-1"),
  );
  assert.throws(() => parseSandboxSessionId("DAYTONA:agent_1:sbx-1"));
});

void test("malformed session ids are rejected", () => {
  const malformed = [
    "",
    "daytona",
    "daytona:",
    "daytona:agent_1",
    "daytona:agent_1:",
    "daytona::sbx-1",
    ":agent_1:sbx-1",
    "daytona:agent_1:sbx-1:extra",
    "daytona:agent 1:sbx-1",
    "daytona:agent_1:sbx 1",
  ];
  for (const value of malformed) {
    assert.throws(
      () => parseSandboxSessionId(value),
      (err: unknown) => err instanceof AgentBackendError,
      `expected rejection for ${JSON.stringify(value)}`,
    );
  }
});

void test("tryParse returns null instead of throwing for unusable ids", () => {
  assert.equal(tryParseSandboxSessionId(null), null);
  assert.equal(tryParseSandboxSessionId(undefined), null);
  assert.equal(tryParseSandboxSessionId(""), null);
  assert.equal(tryParseSandboxSessionId("modal:agent_1:sbx-1"), null);
  assert.deepEqual(tryParseSandboxSessionId(LEGACY_SESSION_ID), {
    provider: "daytona",
    agentId: LEGACY_AGENT_ID,
    providerSandboxId: LEGACY_SANDBOX_ID,
  });
});

void test("building rejects components that would produce an unparseable id", () => {
  assert.throws(() => buildSandboxSessionId("daytona", "", LEGACY_SANDBOX_ID));
  assert.throws(() => buildSandboxSessionId("daytona", "agent:1", LEGACY_SANDBOX_ID));
  assert.throws(() => buildSandboxSessionId("daytona", LEGACY_AGENT_ID, "sbx:1"));
});
