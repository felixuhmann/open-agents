import { Hono } from "hono";
import {
  CreateMcpServerInput,
  ProbeMcpServerInput,
  ProbeStoredMcpServerInput,
  UpdateMcpServerInput,
} from "@open-agents/types";
import { HttpError, requireAdmin, requireUser } from "../../auth/middleware.js";
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
