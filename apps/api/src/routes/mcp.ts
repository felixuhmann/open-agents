import { Hono } from "hono";
import { getAgentBySlug } from "../agents/service.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { buildMcpHandler } from "../mcp/server.js";
import type { AppVariables } from "../server/types.js";

export const MCP_PREFIX = "/mcp";

export const mcpRoutes = new Hono<{ Variables: AppVariables }>();

function isAuthorized(authHeader: string | undefined): boolean {
  if (!authHeader) return false;
  const expected = `Bearer ${config.MCP_AUTH_TOKEN}`;
  if (authHeader.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= authHeader.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

mcpRoutes.all("/:agentSlug", async (c) => {
  const reqId = c.get("reqId");
  const agentSlug = c.req.param("agentSlug");
  const authHeader = c.req.header("authorization");
  log.info("mcp: request received", {
    reqId,
    agentSlug,
    method: c.req.method,
    hasAuthHeader: Boolean(authHeader),
  });

  if (!isAuthorized(authHeader)) {
    log.warn("mcp: unauthorized", { reqId, agentSlug });
    return c.json({ error: "unauthorized" }, 401);
  }

  // Build the handler fresh per request so binding/tool changes are
  // picked up immediately. This is cheap — see comments in mcp/server.ts.
  const agent = await getAgentBySlug(agentSlug);
  if (!agent) {
    log.warn("mcp: unknown agent", { reqId, agentSlug });
    return c.json({ error: `unknown agent: ${agentSlug}` }, 404);
  }

  const handler = buildMcpHandler(agent);
  const start = Date.now();
  const res = await handler(c.req.raw);
  log.info("mcp: handled", {
    reqId,
    agentSlug,
    status: res.status,
    durationMs: Date.now() - start,
  });
  return res;
});
