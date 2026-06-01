import { z } from "zod";

/**
 * Where the code that backs a tool actually executes. `managed` is the
 * Daytona sandbox; `platform` is our backend through host-side Pi bindings.
 *
 * External (user-supplied) MCP servers are tracked separately on
 * `McpServer` library entries — attached per agent via `AgentMcpBinding`, not tool catalog rows.
 */
export const ToolRuntime = z.enum(["managed", "platform"]);
export type ToolRuntime = z.infer<typeof ToolRuntime>;

export const ToolDto = z.object({
  id: z.string(),
  /**
   * Stable identifier. For `managed` runtime: the toolset member name
   * (e.g. `bash`, `read`, `web_search`). For `platform`: the
   * `PlatformHandler.key` registered in
   * `apps/api/src/mcp/platform/index.ts`.
   */
  key: z.string(),
  name: z.string(),
  description: z.string(),
  runtime: ToolRuntime,
  configSchema: z.record(z.string(), z.unknown()),
  requiresSecrets: z.boolean(),
  deprecated: z.boolean(),
});
export type ToolDto = z.infer<typeof ToolDto>;

export const SkillDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  latestVersionId: z.string().nullable(),
  latestVersionNumber: z.number().nullable(),
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number(),
      filename: z.string(),
      createdAt: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SkillDto = z.infer<typeof SkillDto>;
