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

/**
 * A sandbox a provider still owns that has no `AgentSandbox` row. Reported
 * per provider so admins can see which backend is leaking resources.
 */
export const SandboxOrphanSchema = z.object({
  provider: SandboxProviderIdSchema,
  providerSandboxId: z.string(),
  state: z.string(),
  agentId: z.string().optional(),
});
export type SandboxOrphan = z.infer<typeof SandboxOrphanSchema>;

export const SandboxProviderCapabilitiesSchema = z.object({
  networkModes: z.array(z.enum(["deny-all", "unrestricted", "cidr-allowlist"])),
  archive: z.boolean(),
  recover: z.boolean(),
});
export type SandboxProviderCapabilitiesDto = z.infer<
  typeof SandboxProviderCapabilitiesSchema
>;

/** One selectable provider and whether this deployment can currently use it. */
export const SandboxProviderInfoSchema = z.object({
  id: SandboxProviderIdSchema,
  /** Configured (credentials/URL present) and reachable. */
  available: z.boolean(),
  /** Why it is unavailable, when it is. Never contains credentials. */
  detail: z.string().nullable(),
  capabilities: SandboxProviderCapabilitiesSchema.nullable(),
});
export type SandboxProviderInfoDto = z.infer<typeof SandboxProviderInfoSchema>;

export const SandboxProviderStatusSchema = z.object({
  /** Provider new sandboxes are created on, deployment-wide. */
  active: SandboxProviderIdSchema,
  providers: z.array(SandboxProviderInfoSchema),
  warnings: z.array(z.string()),
});
export type SandboxProviderStatusDto = z.infer<typeof SandboxProviderStatusSchema>;

export const SelectSandboxProviderInput = z.object({
  provider: SandboxProviderIdSchema,
});
export type SelectSandboxProviderInput = z.infer<typeof SelectSandboxProviderInput>;
