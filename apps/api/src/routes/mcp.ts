import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { mcpUnauthorizedResponse, resolveMcpAuth } from "../auth/mcpAuth.js";
import { createControlPlaneMcpServer } from "../mcp/controlPlane/server.js";
import { log } from "../log.js";
import { getAppInstance } from "../server/appHolder.js";
import type { AppVariables } from "../server/types.js";

export const MCP_PREFIX = "/mcp";

export const mcpRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Control-plane MCP server (Streamable HTTP). Authenticate with OAuth (recommended
 * for Claude Desktop connectors) or a better-auth session bearer token.
 *
 * Stateless mode: each request spins up a fresh transport + server instance.
 */
mcpRoutes.all("/*", async (c) => {
  const authCtx = await resolveMcpAuth(c.req.raw);
  if (!authCtx) {
    return mcpUnauthorizedResponse();
  }

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createControlPlaneMcpServer({
      app: getAppInstance(),
      authHeaders: authCtx.authHeaders,
    });
    await server.connect(transport);
    return await transport.handleRequest(c.req.raw);
  } catch (err) {
    log.error("mcp: request failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: "internal server error" }, 500);
  }
});
