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

/** Result of an orchestrator-side MCP connectivity probe. */
export const McpProbeStatus = z.enum([
  "connected",
  "auth_failure",
  "unreachable",
  "timeout",
  "protocol_error",
  "error",
]);
export type McpProbeStatus = z.infer<typeof McpProbeStatus>;

export const McpProbeTool = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type McpProbeTool = z.infer<typeof McpProbeTool>;

export const McpProbeDiagnostics = z.object({
  httpStatus: z.number().int().optional(),
  authRequired: z.boolean().optional(),
  authProvided: z.boolean().optional(),
  serverName: z.string().optional(),
  serverVersion: z.string().optional(),
  protocolVersion: z.string().optional(),
});
export type McpProbeDiagnostics = z.infer<typeof McpProbeDiagnostics>;

export const McpProbeResult = z.object({
  ok: z.boolean(),
  status: McpProbeStatus,
  message: z.string(),
  latencyMs: z.number().int().nonnegative().optional(),
  toolCount: z.number().int().nonnegative().optional(),
  tools: z.array(McpProbeTool).optional(),
  diagnostics: McpProbeDiagnostics.optional(),
  probedAt: z.string(),
});
export type McpProbeResult = z.infer<typeof McpProbeResult>;

/** Body for probing an unsaved MCP server (create/edit form). */
export const ProbeMcpServerInput = z.object({
  serverUrl: z.string().url(),
  bearer: z.string().optional(),
});
export type ProbeMcpServerInput = z.infer<typeof ProbeMcpServerInput>;

/** Optional bearer override when probing a stored MCP server by id. */
export const ProbeStoredMcpServerInput = z.object({
  bearer: z.string().optional(),
});
export type ProbeStoredMcpServerInput = z.infer<typeof ProbeStoredMcpServerInput>;

/**
 * Connector manifest exported by deployment-specific MCP connector repos.
 * Bearer tokens are never included — operators paste them in the UI.
 */
export const McpConnectorManifest = z
  .object({
    manifestVersion: z.literal(1),
    name: McpServerNameSchema,
    label: z.string().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
    serverUrl: z.string().url(),
  })
  .or(
    z
      .object({
        name: McpServerNameSchema,
        label: z.string().min(1).max(120),
        description: z.string().max(1000).nullable().optional(),
        serverUrl: z.string().url(),
      })
      .transform((m) => ({ manifestVersion: 1 as const, ...m })),
  );
export type McpConnectorManifest = z.infer<typeof McpConnectorManifest>;
