import { z } from "zod";

export const AgentAccessMode = z.enum(["everyone", "specific"]);
export type AgentAccessMode = z.infer<typeof AgentAccessMode>;

export const RunSurface = z.enum(["email", "chat"]);
export type RunSurface = z.infer<typeof RunSurface>;

export const RunStatus = z.enum(["pending", "running", "succeeded", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const UserRole = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof UserRole>;

/**
 * Anthropic model identifiers we offer in the agent edit page. Free-form
 * string in the DB so a new model can be added without a migration; the
 * enum is the explicit allow-list for UI / API validation.
 */
export const AgentModel = z.enum([
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
]);
export type AgentModel = z.infer<typeof AgentModel>;

export const AgentDto = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string(),
  model: z.string(),
  emailEnabled: z.boolean(),
  webEnabled: z.boolean(),
  accessMode: AgentAccessMode,
  inboundLocalPart: z.string(),
  anthropicAgentId: z.string().nullable(),
  environmentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentDto = z.infer<typeof AgentDto>;

export const AgentSummaryDto = AgentDto.pick({
  id: true,
  slug: true,
  displayName: true,
  description: true,
  emailEnabled: true,
  webEnabled: true,
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
  systemPrompt: z.string().max(20000).optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

export const UpdateAgentInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  systemPrompt: z.string().max(20000).optional(),
  model: AgentModel.optional(),
  emailEnabled: z.boolean().optional(),
  webEnabled: z.boolean().optional(),
  accessMode: AgentAccessMode.optional(),
  inboundLocalPart: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i)
    .optional(),
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
  thirdPartyMcp: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().min(1),
        serverUrl: z.string().url(),
        bearer: z.string().optional(),
      }),
    )
    .optional(),
  accessUserIds: z.array(z.string()).optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentInput>;
