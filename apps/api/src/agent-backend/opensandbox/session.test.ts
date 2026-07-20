import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENSANDBOX_PROVIDER,
  OPENSANDBOX_SESSION_PREFIX,
  SANDBOX_WORKSPACE_DIR,
  buildOpenSandboxSessionId,
  isOpenSandboxSessionId,
  mapOpenSandboxState,
  parseOpenSandboxSessionId,
} from "./session.js";
import { AgentBackendError } from "../types.js";

void test("session id round-trips agent id and sandbox id under the opensandbox prefix", () => {
  const id = buildOpenSandboxSessionId("agent-123", "sbx-abc");
  assert.equal(id, "opensandbox:agent-123:sbx-abc");
  assert.equal(OPENSANDBOX_PROVIDER, "opensandbox");
  assert.equal(OPENSANDBOX_SESSION_PREFIX, "opensandbox");
  const parsed = parseOpenSandboxSessionId(id);
  assert.deepEqual(parsed, { agentId: "agent-123", sandboxId: "sbx-abc" });
});

void test("parsing rejects legacy provider session pointers and malformed ids", () => {
  assert.throws(() => parseOpenSandboxSessionId("legacy:agent:sbx"), AgentBackendError);
  assert.throws(() => parseOpenSandboxSessionId("opensandbox:only"), AgentBackendError);
  assert.throws(() => parseOpenSandboxSessionId(""), AgentBackendError);
  assert.equal(isOpenSandboxSessionId("opensandbox:a:b"), true);
  assert.equal(isOpenSandboxSessionId("legacy:a:b"), false);
});

void test("state mapping normalizes OpenSandbox lifecycle states to canonical states", () => {
  assert.equal(mapOpenSandboxState("Running"), "started");
  assert.equal(mapOpenSandboxState("Paused"), "stopped");
  assert.equal(mapOpenSandboxState("Pausing"), "stopping");
  assert.equal(mapOpenSandboxState("Resuming"), "starting");
  assert.equal(mapOpenSandboxState("Creating"), "creating");
  assert.equal(mapOpenSandboxState("Deleting"), "deleting");
  assert.equal(mapOpenSandboxState("Deleted"), "deleted");
  assert.equal(mapOpenSandboxState("Error"), "error");
  assert.equal(mapOpenSandboxState(undefined), "unknown");
  assert.equal(mapOpenSandboxState("Weird"), "unknown");
});

void test("workspace dir is deterministic /workspace", () => {
  assert.equal(SANDBOX_WORKSPACE_DIR, "/workspace");
});
