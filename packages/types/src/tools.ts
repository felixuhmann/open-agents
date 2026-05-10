import { z } from "zod";

/**
 * Where the code that backs a tool actually executes. `managed` is the
 * agent backend's own compute (Anthropic's container today); `platform`
 * is our backend, served from the per-agent `/mcp/<slug>` endpoint.
 *
 * External (user-supplied) MCP servers are tracked separately on
 * `AgentThirdPartyMcp` — they are per-agent endpoints, not catalog rows.
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
  anthropicSkillId: z.string().nullable(),
  anthropicSkillVersion: z.string().nullable(),
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number(),
      filename: z.string(),
      anthropicSkillId: z.string().nullable(),
      anthropicSkillVersion: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SkillDto = z.infer<typeof SkillDto>;
