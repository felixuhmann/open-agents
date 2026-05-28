import { z } from "zod";

/** Pi model row exposed to the agent editor and catalog API. */
export const ModelCatalogEntryDto = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  api: z.string(),
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  reasoning: z.boolean(),
  inputModalities: z.array(z.enum(["text", "image"])),
});
export type ModelCatalogEntryDto = z.infer<typeof ModelCatalogEntryDto>;

export const ModelCatalogProviderDto = z.object({
  id: z.string(),
  label: z.string(),
  /** Deployment has a service-secret slot for this provider. */
  credentialSupported: z.boolean(),
  /** AES-GCM secret row is populated for this provider. */
  configured: z.boolean(),
  models: z.array(ModelCatalogEntryDto),
});
export type ModelCatalogProviderDto = z.infer<typeof ModelCatalogProviderDto>;

export const ModelCatalogDto = z.object({
  providers: z.array(ModelCatalogProviderDto),
});
export type ModelCatalogDto = z.infer<typeof ModelCatalogDto>;

/** Agent model selection validated against the live Pi catalog. */
export const AgentModelSelection = z.object({
  modelProvider: z.string().min(1).max(64),
  modelId: z.string().min(1).max(256),
});
export type AgentModelSelection = z.infer<typeof AgentModelSelection>;
