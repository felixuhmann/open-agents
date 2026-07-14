import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, type TSchema } from "@earendil-works/pi-ai";
import type { HydratedAgent } from "../agents/service.js";
import { log } from "../log.js";
import { invokePlatformTool } from "./invokePlatformTool.js";
import { jsonSchemaToTypebox, zodShapeToTypebox } from "./jsonSchemaToTypebox.js";
import {
  callThirdPartyTool,
  connectThirdPartyMcpServers,
  closeThirdPartyMcpConnections,
  formatMcpToolResult,
  isOpenAiCompatibleToolName,
  thirdPartyPiToolName,
  type ThirdPartyMcpConnection,
} from "./thirdPartyClient.js";
import { getPlatformHandler } from "./platform/index.js";
import { serializeToolResultForModel } from "./toolResultSerialization.js";
import type { PlatformSandboxCtx } from "./types.js";

const MAX_TOOL_OUTPUT_CHARS = 20_000;

function truncate(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function makeTool<TParams extends TSchema, TDetails = unknown>(tool: {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  executionMode?: "parallel" | "sequential";
  execute: AgentTool<TParams, TDetails>["execute"];
}): AgentTool<TParams, TDetails> {
  return tool;
}

function platformToolLabel(handlerName: string, toolName: string): string {
  return `${handlerName}: ${toolName}`;
}

/**
 * Build Pi `AgentTool` definitions for platform bindings (host-side) and
 * third-party MCP servers (orchestrator-side MCP client).
 *
 * `thirdPartyBearer` maps `McpServer.id` → decrypted bearer token.
 */
export function buildPlatformPiTools(
  agent: HydratedAgent,
  runtime?: { sandbox?: PlatformSandboxCtx },
): AgentTool[] {
  const tools: AgentTool[] = [];

  for (const binding of agent.toolBindings) {
    if (binding.tool.runtime !== "platform") continue;
    const handler = getPlatformHandler(binding.tool.key);
    if (!handler) {
      log.warn("pi-mcp: skipping unknown platform handler", {
        agentSlug: agent.slug,
        handlerKey: binding.tool.key,
      });
      continue;
    }

    const configJson = (binding.configJson ?? {}) as Record<string, unknown>;

    for (const descriptor of handler.tools) {
      const parameters = zodShapeToTypebox(descriptor.inputShape);
      tools.push(
        makeTool({
          name: descriptor.name,
          label: platformToolLabel(handler.name, descriptor.name),
          description: descriptor.description,
          parameters,
          executionMode: "sequential",
          execute: async (_id, params: Static<TSchema>) => {
            const { result, isError } = await invokePlatformTool(
              agent,
              binding.id,
              binding.tool.key,
              descriptor.name,
              params as Record<string, unknown>,
              configJson,
              runtime,
            );
            const text = serializeToolResultForModel(result);
            return {
              content: [{ type: "text", text: truncate(text) }],
              details: { isError, result },
            };
          },
        }),
      );
    }
  }

  return tools;
}

export async function buildThirdPartyPiTools(
  agent: HydratedAgent,
  thirdPartyBearer: ReadonlyMap<string, string>,
): Promise<{ tools: AgentTool[]; connections: ThirdPartyMcpConnection[] }> {
  const servers = agent.mcpBindings.map((binding) => ({
    label: binding.mcpServer.label,
    serverUrl: binding.mcpServer.serverUrl,
    bearer: thirdPartyBearer.get(binding.mcpServer.id) ?? null,
    allowedTools: binding.mcpServer.allowedTools,
  }));

  if (!servers.length) {
    return { tools: [], connections: [] };
  }

  const connections = await connectThirdPartyMcpServers(servers);
  const tools: AgentTool[] = [];

  for (const conn of connections) {
    for (const mcpTool of conn.tools) {
      if (!mcpTool.name) continue;
      const piName = thirdPartyPiToolName(conn.label, mcpTool.name);
      if (!isOpenAiCompatibleToolName(piName)) {
        log.warn("pi-mcp: skipping tool with invalid OpenAI name", {
          agentSlug: agent.slug,
          mcpLabel: conn.label,
          mcpToolName: mcpTool.name,
          piName,
        });
        continue;
      }
      const inputSchema = (mcpTool.inputSchema ?? {
        type: "object",
        properties: {},
      }) as Record<string, unknown>;
      const parameters = jsonSchemaToTypebox(inputSchema);
      const description =
        mcpTool.description ?? `MCP tool from ${conn.label} (${conn.serverUrl})`;

      tools.push(
        makeTool({
          name: piName,
          label: `${conn.label}: ${mcpTool.name}`,
          description,
          parameters,
          executionMode: "sequential",
          execute: async (_id, params: Static<TSchema>) => {
            const { text, isError } = await callThirdPartyTool(
              connections,
              piName,
              params as Record<string, unknown>,
            );
            return {
              content: [{ type: "text", text: truncate(text) }],
              details: { isError },
            };
          },
        }),
      );
    }
  }

  return { tools, connections };
}

export async function buildMcpPiTools(
  agent: HydratedAgent,
  thirdPartyBearer: ReadonlyMap<string, string>,
  runtime?: { sandbox?: PlatformSandboxCtx },
): Promise<{ tools: AgentTool[]; connections: ThirdPartyMcpConnection[] }> {
  const platform = buildPlatformPiTools(agent, runtime);
  const third = await buildThirdPartyPiTools(agent, thirdPartyBearer);
  return { tools: [...platform, ...third.tools], connections: third.connections };
}

export { closeThirdPartyMcpConnections, formatMcpToolResult };
