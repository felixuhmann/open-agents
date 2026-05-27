import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { HydratedAgent } from "../agents/service.js";
import { log } from "../log.js";
import { invokePlatformTool } from "./invokePlatformTool.js";
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
            const { result, isError } = await invokePlatformTool(
              agent,
              binding.id,
              binding.tool.key,
              tool.name,
              args,
              (binding.configJson ?? {}) as Record<string, unknown>,
            );
            const text =
              typeof result === "string" ? result : JSON.stringify(result, null, 2);
            return {
              isError,
              content: [{ type: "text", text }],
            };
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
