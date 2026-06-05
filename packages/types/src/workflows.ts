import { z } from "zod";
import { AgentAccessMode, StarterPromptsSchema } from "./agents.js";

/**
 * One step in a workflow pipeline. Draft steps reference an Agent by id;
 * published steps freeze the agent slug + pinned agent version into the
 * WorkflowVersion payload.
 */
export const WorkflowStepDto = z.object({
  position: z.number().int().nonnegative(),
  agentId: z.string(),
  agentSlug: z.string(),
  agentDisplayName: z.string(),
  agentAvatar: z.string().nullable(),
  /** Whether the referenced agent currently has a published version. */
  agentPublished: z.boolean(),
});
export type WorkflowStepDto = z.infer<typeof WorkflowStepDto>;

export const WorkflowDto = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  starterPrompts: StarterPromptsSchema,
  emailEnabled: z.boolean(),
  inboundLocalPart: z.string(),
  webEnabled: z.boolean(),
  accessMode: AgentAccessMode,
  currentVersionNumber: z.number().int().positive().nullable().optional(),
  currentVersionId: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  steps: z.array(WorkflowStepDto),
  accessUserIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  mailgunDomain: z.string().nullable().optional(),
});
export type WorkflowDto = z.infer<typeof WorkflowDto>;

export const WorkflowSummaryDto = WorkflowDto.pick({
  id: true,
  slug: true,
  displayName: true,
  description: true,
  emailEnabled: true,
  webEnabled: true,
  accessMode: true,
}).extend({
  stepCount: z.number().int().nonnegative(),
  published: z.boolean(),
});
export type WorkflowSummaryDto = z.infer<typeof WorkflowSummaryDto>;

export const CreateWorkflowInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "lowercase letters, digits, and dashes only"),
  displayName: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
});
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowInput>;

export const UpdateWorkflowInput = z.object({
  displayName: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  starterPrompts: StarterPromptsSchema.optional(),
  emailEnabled: z.boolean().optional(),
  inboundLocalPart: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/, "lowercase letters, digits, and dashes only")
    .optional(),
  webEnabled: z.boolean().optional(),
  accessMode: AgentAccessMode.optional(),
  /** Replace-semantics: the ordered list of agent ids the pipeline runs. */
  steps: z
    .array(z.object({ agentId: z.string() }))
    .max(20)
    .optional(),
  accessUserIds: z.array(z.string()).optional(),
});
export type UpdateWorkflowInput = z.infer<typeof UpdateWorkflowInput>;

/** Frozen pipeline config stored in `WorkflowVersion.payload`. */
export const WorkflowConfigSnapshot = z.object({
  schemaVersion: z.literal(1),
  steps: z.array(
    z.object({
      position: z.number().int().nonnegative(),
      agentId: z.string(),
      agentSlug: z.string(),
      agentDisplayName: z.string(),
      /** Agent version frozen at workflow publish time. */
      agentVersionId: z.string(),
      agentVersionNumber: z.number().int().positive(),
    }),
  ),
});
export type WorkflowConfigSnapshot = z.infer<typeof WorkflowConfigSnapshot>;
