import assert from "node:assert/strict";
import test from "node:test";
import { describeResumedSession } from "./resolvedSession.js";

/**
 * `run.started` is the authoritative record of which provider a run actually
 * used. Almost every normal run *resumes* a session, and after a provider
 * switch most of those sessions live on the previous provider — so a resumed
 * run that reports nothing (or reports the active selection) makes the trace
 * lie about where the work happened.
 */

void test("a resumed Daytona session reports Daytona and its sandbox", () => {
  const resolved = describeResumedSession("daytona:agent_1:sbx-1");

  assert.equal(resolved.provider, "daytona");
  assert.equal(resolved.providerSandboxId, "sbx-1");
  assert.equal(resolved.sessionId, "daytona:agent_1:sbx-1");
  assert.equal(resolved.sandboxCreated, false);
});

void test("a resumed broker session reports the broker, not the active selection", () => {
  const resolved = describeResumedSession("broker:agent_1:sbx-42");

  assert.equal(resolved.provider, "broker");
  assert.equal(resolved.providerSandboxId, "sbx-42");
});

void test("a workspace dir learned by mounting is carried through", () => {
  const resolved = describeResumedSession("broker:agent_1:sbx-42", "/workspace");

  assert.equal(resolved.workspaceDir, "/workspace");
});

void test("without a mount the workspace dir is omitted rather than guessed", () => {
  const resolved = describeResumedSession("daytona:agent_1:sbx-1");

  assert.equal("workspaceDir" in resolved, false);
});

void test("an unparseable id still resolves, claiming no provider it cannot prove", () => {
  // Rotation should have replaced this before we got here; if one slips
  // through, an absent provider beats a fabricated one.
  const resolved = describeResumedSession("garbage");

  assert.equal(resolved.sessionId, "garbage");
  assert.equal("provider" in resolved, false);
  assert.equal("providerSandboxId" in resolved, false);
});
