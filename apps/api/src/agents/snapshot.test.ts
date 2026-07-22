import assert from "node:assert/strict";
import test from "node:test";
import { AgentConfigSnapshot } from "@open-agents/types";

/**
 * Characterization of the frozen `AgentVersion.payload` contract as it exists
 * on published (schema v1) rows. These payloads are immutable historical data:
 * whatever this file asserts must keep parsing byte-for-byte after the
 * provider-neutral refactor.
 */

/** Verbatim shape of a real published v1 payload (Daytona-era publish). */
export const LEGACY_V1_PAYLOAD = {
  schemaVersion: 1,
  systemPrompt: "You are a helpful research assistant.",
  modelProvider: "anthropic",
  modelId: "claude-sonnet-4-20250514",
  reasoningLevel: "high",
  profileAccessEnabled: false,
  managedTools: [
    {
      bindingId: "binding_bash",
      toolId: "tool_bash",
      key: "bash",
      runtime: "managed",
      configJson: {},
    },
  ],
  platformTools: [
    {
      bindingId: "binding_memory",
      toolId: "tool_memory",
      key: "memory",
      runtime: "platform",
      configJson: { collection: "notes" },
    },
  ],
  thirdPartyMcp: [
    {
      mcpServerId: "mcp_1",
      label: "docs",
      serverUrl: "https://mcp.example.com/mcp",
    },
  ],
  skillBindings: [
    {
      skillId: "skill_1",
      skillVersionId: "skillver_1",
      skillName: "Weekly Report",
      versionNumber: 3,
    },
  ],
  subagentBindings: [
    {
      subagentId: "agent_child",
      slug: "child",
      displayName: "Child",
      description: "delegate",
      agentVersionId: "ver_child_2",
    },
  ],
  runtime: {
    backend: "daytona",
    sandbox: {
      network: {
        internetEnabled: true,
        allowList: "10.0.0.0/8",
        protectInternalNetwork: true,
      },
      command: {
        denyRules: ["rm -rf /"],
        approvalGatePatterns: [],
        maxRuntimeSeconds: 60,
        maxOutputChars: 20_000,
        maxBackgroundProcessLifetimeSeconds: 600,
      },
    },
  },
} as const;

void test("legacy schema v1 payload parses unchanged", () => {
  const parsed = AgentConfigSnapshot.parse(LEGACY_V1_PAYLOAD);

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.systemPrompt, "You are a helpful research assistant.");
  assert.equal(parsed.modelProvider, "anthropic");
  assert.equal(parsed.modelId, "claude-sonnet-4-20250514");
  assert.equal(parsed.reasoningLevel, "high");
  assert.equal(parsed.profileAccessEnabled, false);
  assert.deepEqual(parsed.managedTools, LEGACY_V1_PAYLOAD.managedTools);
  assert.deepEqual(parsed.platformTools, LEGACY_V1_PAYLOAD.platformTools);
  assert.deepEqual(parsed.thirdPartyMcp, LEGACY_V1_PAYLOAD.thirdPartyMcp);
  assert.deepEqual(parsed.skillBindings, LEGACY_V1_PAYLOAD.skillBindings);
  assert.deepEqual(parsed.subagentBindings, LEGACY_V1_PAYLOAD.subagentBindings);
});

void test("legacy v1 runtime pins the Daytona backend and frozen sandbox policy", () => {
  const parsed = AgentConfigSnapshot.parse(LEGACY_V1_PAYLOAD);

  assert.equal(parsed.runtime.backend, "daytona");
  assert.equal(parsed.runtime.sandbox?.network.internetEnabled, true);
  assert.equal(parsed.runtime.sandbox?.network.allowList, "10.0.0.0/8");
  assert.equal(parsed.runtime.sandbox?.network.protectInternalNetwork, true);
  assert.deepEqual(parsed.runtime.sandbox?.command.denyRules, ["rm -rf /"]);
  assert.equal(parsed.runtime.sandbox?.command.maxRuntimeSeconds, 60);
});

void test("v1 payloads predating later fields fall back to documented defaults", () => {
  const parsed = AgentConfigSnapshot.parse({
    schemaVersion: 1,
    systemPrompt: "old agent",
    modelProvider: "anthropic",
    modelId: "claude-3-5-sonnet",
    managedTools: [],
    platformTools: [],
    thirdPartyMcp: [],
    skillBindings: [],
    runtime: { backend: "daytona" },
  });

  assert.equal(parsed.reasoningLevel, "high");
  assert.equal(parsed.profileAccessEnabled, false);
  assert.deepEqual(parsed.subagentBindings, []);
  assert.equal(parsed.runtime.sandbox, undefined);
});

void test("v1 thirdPartyMcp rows written with `id` are still accepted", () => {
  const parsed = AgentConfigSnapshot.parse({
    ...LEGACY_V1_PAYLOAD,
    thirdPartyMcp: [{ id: "mcp_legacy", label: "old", serverUrl: "https://old/mcp" }],
  });

  assert.equal(parsed.thirdPartyMcp[0]?.mcpServerId, "mcp_legacy");
});

void test("unknown schema versions are rejected rather than silently coerced", () => {
  assert.throws(() =>
    AgentConfigSnapshot.parse({ ...LEGACY_V1_PAYLOAD, schemaVersion: 99 }),
  );
  assert.throws(() =>
    AgentConfigSnapshot.parse({ ...LEGACY_V1_PAYLOAD, schemaVersion: undefined }),
  );
});

void test("snapshots missing required identity fields are rejected", () => {
  assert.throws(() =>
    AgentConfigSnapshot.parse({ ...LEGACY_V1_PAYLOAD, modelId: "" }),
  );
  assert.throws(() =>
    AgentConfigSnapshot.parse({ ...LEGACY_V1_PAYLOAD, managedTools: undefined }),
  );
});
