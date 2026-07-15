import { z } from "zod";
import {
  SandboxCommandPolicySchema,
  SandboxNetworkPolicySchema,
} from "./sandboxPolicy.js";

export const AgentAccessMode = z.enum(["everyone", "specific"]);
export type AgentAccessMode = z.infer<typeof AgentAccessMode>;

export const RunSurface = z.enum(["email", "chat"]);
export type RunSurface = z.infer<typeof RunSurface>;

export const RunStatus = z.enum(["pending", "running", "succeeded", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const UserRole = z.enum(["admin", "contributor", "member"]);
export type UserRole = z.infer<typeof UserRole>;

import { AgentModelSelection, ReasoningLevelSchema } from "./modelCatalog.js";

/** Chat empty-state suggestion chips (web surface only). */
export const StarterPromptsSchema = z.array(z.string().trim().min(1).max(200)).max(8);
export type StarterPrompts = z.infer<typeof StarterPromptsSchema>;

export const AgentDto = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  starterPrompts: StarterPromptsSchema,
  systemPrompt: z.string(),
  modelProvider: z.string(),
  modelId: z.string(),
  reasoningLevel: ReasoningLevelSchema,
  /**
   * Stored avatar reference. Either a bare filename inside the bundled
   * `apps/api/src/emails/static/` directory, a `/static/...` URL path
   * (e.g. `/static/uploads/avatars/<file>` for admin uploads), or an
   * absolute `https://...` URL. `null` when the agent uses the default
   * fallback avatar.
   */
  avatar: z.string().nullable(),
  emailEnabled: z.boolean(),
  webEnabled: z.boolean(),
  profileAccessEnabled: z.boolean(),
  publicShareEnabled: z.boolean(),
  accessMode: AgentAccessMode,
  inboundLocalPart: z.string(),
  currentVersionNumber: z.number().int().positive().nullable().optional(),
  currentVersionId: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  sandboxNetworkPolicy: SandboxNetworkPolicySchema,
  sandboxCommandPolicy: SandboxCommandPolicySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentDto = z.infer<typeof AgentDto>;

export const AgentSummaryDto = AgentDto.pick({
  id: true,
  slug: true,
  displayName: true,
  description: true,
  category: true,
  avatar: true,
  emailEnabled: true,
  webEnabled: true,
  profileAccessEnabled: true,
  accessMode: true,
});
export type AgentSummaryDto = z.infer<typeof AgentSummaryDto>;

export const CreateAgentInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "lowercase letters, digits, and dashes only"),
  displayName: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  category: z
    .string()
    .max(120)
    .describe("Optional free-form category for grouping and filtering agents")
    .optional(),
  systemPrompt: z.string().max(20000).optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

export const UpdateAgentInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  category: z
    .string()
    .max(120)
    .describe(
      "Optional free-form category for grouping and filtering agents; set null to clear",
    )
    .nullable()
    .optional(),
  /** Replace-semantics: prompts shown in the web chat empty state. */
  starterPrompts: StarterPromptsSchema.optional(),
  systemPrompt: z.string().max(20000).optional(),
  modelProvider: AgentModelSelection.shape.modelProvider.optional(),
  modelId: AgentModelSelection.shape.modelId.optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
  emailEnabled: z.boolean().optional(),
  webEnabled: z.boolean().optional(),
  profileAccessEnabled: z.boolean().optional(),
  accessMode: AgentAccessMode.optional(),
  inboundLocalPart: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i)
    .optional(),
  /**
   * Replace-semantics for the agent avatar reference. Set via
   * `POST /api/agents/:slug/avatar` (multipart upload) under the hood,
   * but PATCH also accepts a string for legacy callers that want to
   * switch back to a bundled filename, or `null` to clear.
   */
  avatar: z.string().max(1024).nullable().optional(),
  /**
   * Replace-semantics: every binding the agent should have after the
   * patch, regardless of runtime. Each entry references a `Tool.id`.
   */
  toolBindings: z
    .array(
      z.object({
        toolId: z.string(),
        configJson: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  skillIds: z.array(z.string()).optional(),
  skillBindings: z
    .array(
      z.object({
        skillId: z.string(),
        skillVersionId: z.string(),
      }),
    )
    .optional(),
  /** Replace-semantics: MCP servers from the library attached to this agent. */
  mcpServerIds: z.array(z.string()).optional(),
  /**
   * Replace-semantics: other agents this agent may delegate to via the
   * `run_subagent` tool. Each entry is an `Agent.id`; the agent's own id is
   * ignored (no self-delegation).
   */
  subagentIds: z.array(z.string()).optional(),
  accessUserIds: z.array(z.string()).optional(),
  sandboxNetworkPolicy: SandboxNetworkPolicySchema.optional(),
  sandboxCommandPolicy: SandboxCommandPolicySchema.optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentInput>;
