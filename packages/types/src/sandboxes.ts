import { z } from "zod";

/**
 * Sandbox providers this deployment can talk to. `daytona` is the historical
 * value and stays the default for rows/settings that predate the choice.
 */
export const SandboxProviderIdSchema = z.enum(["daytona", "broker"]);
export type SandboxProviderId = z.infer<typeof SandboxProviderIdSchema>;

export const SandboxLifecyclePolicySchema = z.object({
  autoStopInterval: z.number().int(),
  autoArchiveInterval: z.number().int(),
  autoDeleteInterval: z.number().int(),
});

export type SandboxLifecyclePolicy = z.infer<typeof SandboxLifecyclePolicySchema>;

export const SandboxSummarySchema = z.object({
  id: z.string(),
  provider: z.string(),
  providerSandboxId: z.string(),
  sessionId: z.string(),
  state: z.string(),
  agentId: z.string(),
  agentSlug: z.string().optional(),
  agentDisplayName: z.string().optional(),
  surface: z.enum(["chat", "email"]).nullable(),
  conversationId: z.string().nullable(),
  conversationTitle: z.string().nullable(),
  threadId: z.string().nullable(),
  threadSubject: z.string().nullable(),
  lifecyclePolicy: SandboxLifecyclePolicySchema,
  lastActivityAt: z.string(),
  lastSyncedAt: z.string().nullable(),
  errorReason: z.string().nullable(),
  recoverable: z.boolean().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SandboxSummaryDto = z.infer<typeof SandboxSummarySchema>;
