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

export const McpAuthType = z.enum(["none", "bearer", "oauth2"]);
export type McpAuthType = z.infer<typeof McpAuthType>;

export const McpOAuthProvider = z.enum(["google"]);
export type McpOAuthProvider = z.infer<typeof McpOAuthProvider>;

export const GOOGLE_DRIVE_MCP_PRESET = {
  name: "google-drive",
  label: "Google Drive",
  description: "Read files from a least-privilege Google Drive connection.",
  serverUrl: "https://drivemcp.googleapis.com/mcp/v1",
  scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
  allowedTools: [
    "search_files",
    "list_recent_files",
    "get_file_metadata",
    "get_file_permissions",
    "read_file_content",
    "download_file_content",
  ],
} as const;

export const McpOAuthInput = z.object({
  provider: McpOAuthProvider,
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().min(1).max(2000),
  scopes: z.array(z.string().trim().min(1)).min(1),
});
export type McpOAuthInput = z.infer<typeof McpOAuthInput>;

export const McpOAuthStatus = z.object({
  provider: McpOAuthProvider,
  clientId: z.string(),
  connected: z.boolean(),
  subject: z.string().nullable(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable(),
  redirectUri: z.string().url(),
});
export type McpOAuthStatus = z.infer<typeof McpOAuthStatus>;

export const McpServerDto = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  serverUrl: z.string(),
  authType: McpAuthType,
  hasBearer: z.boolean(),
  oauth: McpOAuthStatus.nullable(),
  allowedTools: z.array(z.string()),
  agentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type McpServerDto = z.infer<typeof McpServerDto>;

const McpServerBaseInput = z.object({
  name: McpServerNameSchema,
  label: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  serverUrl: z.string().url(),
  authType: McpAuthType.optional(),
  bearer: z.string().optional(),
  oauth: McpOAuthInput.optional(),
  allowedTools: z.array(z.string().trim().min(1)).max(200).optional(),
});

export const CreateMcpServerInput = McpServerBaseInput.superRefine((value, ctx) => {
  if (value.authType === "oauth2" && !value.oauth) {
    ctx.addIssue({
      code: "custom",
      path: ["oauth"],
      message: "OAuth client credentials are required for OAuth MCP servers",
    });
  }
});
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerInput>;

export const UpdateMcpServerInput = z.object({
  name: McpServerNameSchema.optional(),
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  serverUrl: z.string().url().optional(),
  authType: McpAuthType.optional(),
  bearer: z.string().optional(),
  oauth: McpOAuthInput.partial({ clientSecret: true }).optional(),
  allowedTools: z.array(z.string().trim().min(1)).max(200).optional(),
});
export type UpdateMcpServerInput = z.infer<typeof UpdateMcpServerInput>;

export const McpOAuthStartResult = z.object({ authorizationUrl: z.string().url() });
export type McpOAuthStartResult = z.infer<typeof McpOAuthStartResult>;

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
  allowedTools: z.array(z.string()).optional(),
});
export type ProbeMcpServerInput = z.infer<typeof ProbeMcpServerInput>;

/** Optional bearer override when probing a stored MCP server by id. */
export const ProbeStoredMcpServerInput = z.object({
  bearer: z.string().optional(),
});
export type ProbeStoredMcpServerInput = z.infer<typeof ProbeStoredMcpServerInput>;

/**
 * Connector manifest exported by deployment-specific MCP connector repos.
 * Credentials are never included — operators enter them in the UI.
 */
export const McpConnectorManifest = z
  .object({
    manifestVersion: z.literal(1),
    name: McpServerNameSchema,
    label: z.string().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
    serverUrl: z.string().url(),
    allowedTools: z.array(z.string()).optional(),
  })
  .or(
    z
      .object({
        name: McpServerNameSchema,
        label: z.string().min(1).max(120),
        description: z.string().max(1000).nullable().optional(),
        serverUrl: z.string().url(),
        allowedTools: z.array(z.string()).optional(),
      })
      .transform((m) => ({ manifestVersion: 1 as const, ...m })),
  );
export type McpConnectorManifest = z.infer<typeof McpConnectorManifest>;
