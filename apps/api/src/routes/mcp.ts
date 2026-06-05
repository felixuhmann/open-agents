import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { auth } from "../auth/index.js";
import { createControlPlaneMcpServer } from "../mcp/controlPlane/server.js";
import { log } from "../log.js";
import { getAppInstance } from "../server/appHolder.js";
import type { AppVariables } from "../server/types.js";

export const MCP_PREFIX = "/mcp";

export const mcpRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Control-plane MCP server (Streamable HTTP). Authenticate with the same
 * better-auth session token the SPA uses, passed as `Authorization: Bearer`.
 *
 * Stateless mode: each request spins up a fresh transport + server instance.
 */
mcpRoutes.all("/*", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json(
      { error: "unauthorized — provide Authorization: Bearer <session_token>" },
      401,
    );
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
      authHeaders: c.req.raw.headers,
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
