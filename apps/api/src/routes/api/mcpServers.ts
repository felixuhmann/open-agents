import { Hono } from "hono";
import {
  CreateMcpServerInput,
  ProbeMcpServerInput,
  ProbeStoredMcpServerInput,
  UpdateMcpServerInput,
} from "@open-agents/types";
import { HttpError, requireAdmin, requireUser } from "../../auth/middleware.js";
import { config } from "../../config.js";
import { log } from "../../log.js";
import {
  completeMcpOAuthAuthorization,
  createMcpOAuthAuthorizationUrl,
  disconnectMcpOAuth,
} from "../../mcp/oauth/mcpOAuthService.js";
import type { AppVariables } from "../../server/types.js";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServerById,
  listMcpServers,
  probeMcpServerDraft,
  probeStoredMcpServer,
  toMcpServerDto,
  updateMcpServer,
} from "../../services/mcpServers.js";

export const mcpServersRoutes = new Hono<{ Variables: AppVariables }>();

function oauthResultRedirect(status: "connected" | "error", message?: string): string {
  const url = new URL("/library/mcp", config.WEB_BASE_URL);
  url.searchParams.set("oauth", status);
  if (message) url.searchParams.set("message", message);
  return url.toString();
}

/** OAuth callback metadata comes from backend configuration, not browser origin. */
mcpServersRoutes.get("/oauth/config", (c) => {
  requireAdmin(c);
  return c.json({
    redirectUri: `${config.PUBLIC_BASE_URL}/api/mcp-servers/oauth/callback`,
  });
});

/** Google redirects here after administrator consent. Signed state identifies the server. */
mcpServersRoutes.get("/oauth/callback", async (c) => {
  requireAdmin(c);
  const state = c.req.query("state");
  const code = c.req.query("code");
  const oauthError = c.req.query("error");
  if (oauthError) {
    return c.redirect(oauthResultRedirect("error", "Google authorization was cancelled"));
  }
  if (!state || !code) {
    return c.redirect(
      oauthResultRedirect("error", "Google OAuth callback was incomplete"),
    );
  }
  try {
    await completeMcpOAuthAuthorization({ state, code });
    return c.redirect(oauthResultRedirect("connected"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("mcp-oauth: callback failed", { err: message });
    return c.redirect(oauthResultRedirect("error", message));
  }
});

mcpServersRoutes.post("/probe", async (c) => {
  requireAdmin(c);
  const body = ProbeMcpServerInput.parse(await c.req.json());
  const result = await probeMcpServerDraft(body);
  return c.json(result);
});

mcpServersRoutes.get("/", async (c) => {
  requireUser(c);
  const servers = await listMcpServers();
  return c.json({ servers: servers.map(toMcpServerDto) });
});

mcpServersRoutes.post("/:id/probe", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");
  const body = ProbeStoredMcpServerInput.parse(await c.req.json().catch(() => ({})));
  const result = await probeStoredMcpServer(id, body.bearer);
  return c.json(result);
});

mcpServersRoutes.post("/:id/oauth/start", async (c) => {
  requireAdmin(c);
  const authorizationUrl = await createMcpOAuthAuthorizationUrl(c.req.param("id"));
  return c.json({ authorizationUrl });
});

mcpServersRoutes.post("/:id/oauth/disconnect", async (c) => {
  requireAdmin(c);
  await disconnectMcpOAuth(c.req.param("id"));
  return c.json({ ok: true });
});

mcpServersRoutes.get("/:id", async (c) => {
  requireUser(c);
  const row = await getMcpServerById(c.req.param("id"));
  if (!row) throw new HttpError(404, "MCP server not found");
  return c.json(toMcpServerDto(row));
});

mcpServersRoutes.post("/", async (c) => {
  requireAdmin(c);
  const body = CreateMcpServerInput.parse(await c.req.json());
  const created = await createMcpServer(body);
  const row = await getMcpServerById(created.id);
  if (!row) throw new HttpError(500, "MCP server missing after create");
  return c.json(toMcpServerDto(row), 201);
});

mcpServersRoutes.patch("/:id", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");
  const body = UpdateMcpServerInput.parse(await c.req.json());
  await updateMcpServer(id, body);
  const row = await getMcpServerById(id);
  if (!row) throw new HttpError(404, "MCP server not found");
  return c.json(toMcpServerDto(row));
});

mcpServersRoutes.delete("/:id", async (c) => {
  requireAdmin(c);
  await deleteMcpServer(c.req.param("id"));
  return c.json({ ok: true });
});
