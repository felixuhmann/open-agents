import { z } from "zod";

export const McpServerDto = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  serverUrl: z.string(),
  hasBearer: z.boolean(),
  agentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type McpServerDto = z.infer<typeof McpServerDto>;

export const CreateMcpServerInput = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(
      /^[a-z0-9][a-z0-9-_]*[a-z0-9]$/,
      "lowercase letters, digits, dashes, and underscores only",
    ),
  label: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  serverUrl: z.string().url(),
  bearer: z.string().optional(),
});
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerInput>;

export const UpdateMcpServerInput = z.object({
  name: CreateMcpServerInput.shape.name.optional(),
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  serverUrl: z.string().url().optional(),
  bearer: z.string().optional(),
});
export type UpdateMcpServerInput = z.infer<typeof UpdateMcpServerInput>;
