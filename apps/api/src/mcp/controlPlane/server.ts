import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ControlPlaneMcpContext } from "./context.js";
import { registerControlPlaneTools } from "./defineTool.js";
import { CONTROL_PLANE_TOOLS } from "./tools/index.js";

export type { ControlPlaneMcpContext } from "./context.js";

export function createControlPlaneMcpServer(ctx: ControlPlaneMcpContext): McpServer {
  const server = new McpServer(
    {
      name: "open-agents",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerControlPlaneTools(server, ctx, CONTROL_PLANE_TOOLS);

  return server;
}
