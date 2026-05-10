import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { HydratedAgent } from "../agents/service.js";
import { log } from "../log.js";
import { getToolSecrets } from "../secrets/service.js";
import { getPlatformHandler } from "./platform/index.js";

/**
 * Build a stateless Streamable HTTP MCP handler for a single agent. The
 * MCP SDK's stateless transport explicitly cannot be reused across requests,
 * so we construct a fresh `McpServer` + transport per call. Tool registration
 * walks the agent's `toolBindings`, ignoring any non-`platform` runtime
 * (managed tools execute on Anthropic's side, not here), looks up the
 * platform handler by `tool.key`, and registers every descriptor it exposes.
 */
export function buildMcpHandler(
  agent: HydratedAgent,
): (req: Request) => Promise<Response> {
  function buildServer(): McpServer {
    const server = new McpServer(
      { name: `open-agents-${agent.slug}`, version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    for (const binding of agent.toolBindings) {
      if (binding.tool.runtime !== "platform") continue;
      const handler = getPlatformHandler(binding.tool.key);
      if (!handler) {
        log.warn("mcp: skipping binding with unknown handler key", {
          agentSlug: agent.slug,
          handlerKey: binding.tool.key,
        });
        continue;
      }

      for (const tool of handler.tools) {
        server.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.inputShape,
          },
          async (args: Record<string, unknown>) => {
            try {
              const secrets = await getToolSecrets(binding.id);
              const result = await tool.handler(args, {
                agentId: agent.id,
                agentSlug: agent.slug,
                configJson: (binding.configJson ?? {}) as Record<string, unknown>,
                secrets,
              });
              return {
                content: [{ type: "text", text: JSON.stringify(result) }],
              };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log.warn("mcp tool error", {
                agentSlug: agent.slug,
                tool: tool.name,
                handlerKey: handler.key,
                err: msg,
              });
              return {
                isError: true,
                content: [{ type: "text", text: `Error: ${msg}` }],
              };
            }
          },
        );
      }
    }

    return server;
  }

  return async (req: Request) => {
    const server = buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}
