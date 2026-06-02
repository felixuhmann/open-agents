import { z } from "zod";

/** Stable slug for MCP library entries (normalized to lowercase). */
export const McpServerNameSchema = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(60)
      .regex(
        /^[a-z0-9]([a-z0-9-_]*[a-z0-9])?$/,
        "Use lowercase letters, digits, dashes, or underscores; cannot start or end with - or _",
      ),
  );

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
  name: McpServerNameSchema,
  label: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  serverUrl: z.string().url(),
  bearer: z.string().optional(),
});
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerInput>;

export const UpdateMcpServerInput = z.object({
  name: McpServerNameSchema.optional(),
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  serverUrl: z.string().url().optional(),
  bearer: z.string().optional(),
});
export type UpdateMcpServerInput = z.infer<typeof UpdateMcpServerInput>;
