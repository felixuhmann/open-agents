import { z } from "zod";
import {
  SandboxCommandPolicySchema,
  SandboxNetworkPolicySchema,
} from "./sandboxPolicy.js";

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

export const AgentConfigThirdPartyMcp = z.object({
  id: z.string(),
  label: z.string(),
  serverUrl: z.string(),
});
export type AgentConfigThirdPartyMcp = z.infer<typeof AgentConfigThirdPartyMcp>;

export const AgentConfigRuntime = z.object({
  backend: z.enum(["anthropic", "daytona"]),
  /** Frozen sandbox security policy for Daytona runs. Omitted on legacy snapshots. */
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
  managedTools: z.array(AgentConfigToolBinding),
  platformTools: z.array(AgentConfigToolBinding),
  thirdPartyMcp: z.array(AgentConfigThirdPartyMcp),
  skillBindings: z.array(AgentConfigSkillBinding),
  runtime: AgentConfigRuntime,
});
export type AgentConfigSnapshot = z.infer<typeof AgentConfigSnapshot>;

/** Optional backend-specific sync metadata (legacy Anthropic provisioning). */
export const AgentVersionProviderRefs = z.object({
  anthropic: z
    .object({
      agentId: z.string(),
      environmentId: z.string(),
      version: z.string(),
      mcpCredentialId: z.string().optional(),
      mcpCredentialUrl: z.string().optional(),
    })
    .optional(),
});
export type AgentVersionProviderRefs = z.infer<typeof AgentVersionProviderRefs>;

export const AgentVersionSummaryDto = z.object({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  createdAt: z.string(),
});
export type AgentVersionSummaryDto = z.infer<typeof AgentVersionSummaryDto>;
