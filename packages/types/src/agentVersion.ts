import { z } from "zod";
import {
  SandboxCommandPolicySchema,
  SandboxNetworkPolicySchema,
} from "./sandboxPolicy.js";
import { ReasoningLevelSchema } from "./modelCatalog.js";

/** Discriminator for the frozen config payload schema. */
export const AGENT_CONFIG_SNAPSHOT_SCHEMA_VERSION = 1 as const;

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

export const AgentConfigRuntime = z.object({
  /** Historical snapshots may name a retired provider; new publishes use OpenSandbox. */
  backend: z.string().min(1),
  /** Frozen sandbox security policy for OpenSandbox runs. */
  sandbox: z
    .object({
      network: SandboxNetworkPolicySchema,
      command: SandboxCommandPolicySchema,
    })
    .optional(),
});
export type AgentConfigRuntime = z.infer<typeof AgentConfigRuntime>;

/**
 * Provider-neutral frozen agent config stored in `AgentVersion.payload`.
 * Captures everything a run needs to audit against the exact runtime definition.
 */
export const AgentConfigSnapshot = z.object({
  schemaVersion: z.literal(AGENT_CONFIG_SNAPSHOT_SCHEMA_VERSION),
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
  runtime: AgentConfigRuntime,
});
export type AgentConfigSnapshot = z.infer<typeof AgentConfigSnapshot>;

export const AgentVersionSummaryDto = z.object({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  createdAt: z.string(),
});
export type AgentVersionSummaryDto = z.infer<typeof AgentVersionSummaryDto>;
