import { z } from "zod";

export const ServiceSecretKey = z.enum([
  "anthropic_api_key",
  "openai_api_key",
  "openrouter_api_key",
  "mailgun_api_key",
  "mailgun_domain",
  "mailgun_signing_key",
]);
export type ServiceSecretKey = z.infer<typeof ServiceSecretKey>;

export const SetServiceSecretInput = z.object({
  value: z.string().min(1).describe("Secret value (encrypted at rest)"),
});
export type SetServiceSecretInput = z.infer<typeof SetServiceSecretInput>;

export const AppSettingKey = z.enum([
  "product_name",
  "favicon_url",
  "sidebar_logo_url",
  "email_footer_logo_url",
  "email_disclaimer",
  "inbound_from",
]);
export type AppSettingKey = z.infer<typeof AppSettingKey>;

export const SetAppSettingInput = z.object({
  value: z.string().describe("Setting value (empty string deletes the setting)"),
});
export type SetAppSettingInput = z.infer<typeof SetAppSettingInput>;

export const ListSandboxesQuery = z.object({
  agentId: z.string().optional().describe("Filter by agent id"),
  state: z.string().optional().describe("Filter by sandbox state"),
  surface: z.enum(["chat", "email"]).optional().describe("Filter by surface"),
  limit: z.coerce.number().int().min(1).max(200).optional().describe("Page size"),
  offset: z.coerce.number().int().min(0).optional().describe("Page offset"),
});
export type ListSandboxesQuery = z.infer<typeof ListSandboxesQuery>;

export const RunEventsQuery = z.object({
  lastEventId: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Replay events after this sequence (SSE)"),
});
export type RunEventsQuery = z.infer<typeof RunEventsQuery>;
