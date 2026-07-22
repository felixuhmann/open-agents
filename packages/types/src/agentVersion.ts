import { z } from "zod";
import {
  SandboxCommandPolicySchema,
  SandboxNetworkPolicySchema,
} from "./sandboxPolicy.js";
import { ReasoningLevelSchema } from "./modelCatalog.js";

/**
 * Schema version new publishes write.
 *
 * v1 froze `runtime.backend: "daytona"` at publish time. That was never
 * routing information — the provider a run actually used is a property of
 * its `AgentSandbox` row — so v2 drops it. v1 rows stay immutable and keep
 * parsing; the source version is preserved for audit display.
 */
export const AGENT_CONFIG_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export const AgentConfigToolBinding = z.object({
  bindingId: z.string(),
  toolId: z.string(),
  key: z.string(),
  runtime: z.enum(["managed", "platform"]),
  configJson: z.record(z.string(), z.unknown()).optional(),
});
export type AgentConfigToolBinding = z.infer<typeof AgentConfigToolBinding>;

export const AgentConfigSkillBinding = z.object({
  skillId: z.string(),
  skillVersionId: z.string(),
  skillName: z.string(),
  versionNumber: z.number().int().positive(),
});
export type AgentConfigSkillBinding = z.infer<typeof AgentConfigSkillBinding>;

export const AgentConfigMcpServer = z.object({
  mcpServerId: z.string(),
  label: z.string(),
  serverUrl: z.string(),
});
export type AgentConfigMcpServer = z.infer<typeof AgentConfigMcpServer>;

/**
 * Frozen delegation target. Captured at publish time with the callee's
 * then-current published version pinned, so a delegation runs the exact
 * subagent config that existed when the caller was published.
 */
export const AgentConfigSubagentBinding = z.object({
  subagentId: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullish(),
  /** Pinned published version of the callee to execute. */
  agentVersionId: z.string(),
});
export type AgentConfigSubagentBinding = z.infer<typeof AgentConfigSubagentBinding>;

/** @deprecated Alias for `AgentConfigMcpServer`. */
export type AgentConfigThirdPartyMcp = AgentConfigMcpServer;

/** Frozen sandbox security policy. Optional on both schema versions. */
const AgentConfigSandboxPolicy = z
  .object({
    network: SandboxNetworkPolicySchema,
    command: SandboxCommandPolicySchema,
  })
  .optional();

/** v1 runtime: sandbox policy plus the publish-time Daytona backend pin. */
export const AgentConfigRuntimeV1 = z.object({
  backend: z.literal("daytona"),
  sandbox: AgentConfigSandboxPolicy,
});

/** v2 runtime: sandbox policy only. */
export const AgentConfigRuntimeV2 = z.object({
  sandbox: AgentConfigSandboxPolicy,
});

/** Normalized runtime shape both versions parse into. */
export type AgentConfigRuntime = {
  /**
   * Publish-time backend pin, present only on schema-v1 rows. Retained for
   * audit; it does NOT decide which provider a run uses.
   */
  backend?: "daytona";
  sandbox?: z.infer<typeof AgentConfigSandboxPolicy>;
};

/** Fields every schema version shares. */
const agentConfigSnapshotFields = {
  systemPrompt: z.string(),
  modelProvider: z.string().min(1),
  modelId: z.string().min(1),
  /** Requested Pi reasoning effort. Defaults preserve pre-field snapshots. */
  reasoningLevel: ReasoningLevelSchema.default("high"),
  profileAccessEnabled: z.boolean().default(false),
  managedTools: z.array(AgentConfigToolBinding),
  platformTools: z.array(AgentConfigToolBinding),
  thirdPartyMcp: z.preprocess((val: unknown) => {
    if (!Array.isArray(val)) return val;
    return val.map((row: unknown) => {
      if (!row || typeof row !== "object") return row;
      const r = row as Record<string, unknown>;
      if (typeof r.mcpServerId === "string") return row;
      if (typeof r.id === "string") return { ...r, mcpServerId: r.id };
      return row;
    });
  }, z.array(AgentConfigMcpServer)),
  skillBindings: z.array(AgentConfigSkillBinding),
  /** Agents this agent may delegate to, each pinned to a published version. */
  subagentBindings: z.array(AgentConfigSubagentBinding).default([]),
};

/** Historical schema. Immutable: these rows are never rewritten. */
export const AgentConfigSnapshotV1 = z.object({
  schemaVersion: z.literal(1),
  ...agentConfigSnapshotFields,
  runtime: AgentConfigRuntimeV1,
});

/** Current schema. The sandbox provider is no longer an agent-level setting. */
export const AgentConfigSnapshotV2 = z.object({
  schemaVersion: z.literal(2),
  ...agentConfigSnapshotFields,
  runtime: AgentConfigRuntimeV2,
});

/**
 * Provider-neutral frozen agent config stored in `AgentVersion.payload`.
 *
 * Parsing accepts either schema version and yields one normalized internal
 * representation, keeping `schemaVersion` so the builder UI can show which
 * schema a historical version was published under.
 */
export const AgentConfigSnapshot = z
  .discriminatedUnion("schemaVersion", [AgentConfigSnapshotV1, AgentConfigSnapshotV2])
  .transform((parsed) => {
    const runtime: AgentConfigRuntime = {
      ...("backend" in parsed.runtime ? { backend: parsed.runtime.backend } : {}),
      ...(parsed.runtime.sandbox ? { sandbox: parsed.runtime.sandbox } : {}),
    };
    return { ...parsed, runtime };
  });
export type AgentConfigSnapshot = z.infer<typeof AgentConfigSnapshot>;

export const AgentVersionSummaryDto = z.object({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  createdAt: z.string(),
});
export type AgentVersionSummaryDto = z.infer<typeof AgentVersionSummaryDto>;
