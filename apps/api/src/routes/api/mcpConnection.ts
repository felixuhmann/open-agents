import { Hono } from "hono";
import { HttpError, requireUser } from "../../auth/middleware.js";
import type { AppVariables } from "../../server/types.js";
import {
  createMcpConnectionToken,
  getMcpConnectionInfo,
  listMcpConnectionTokens,
  revokeMcpConnectionToken,
} from "../../services/mcpConnection.js";

export const mcpConnectionRoutes = new Hono<{ Variables: AppVariables }>();

mcpConnectionRoutes.get("/info", (c) => {
  requireUser(c);
  return c.json(getMcpConnectionInfo());
});

mcpConnectionRoutes.get("/tokens", async (c) => {
  const user = requireUser(c);
  const tokens = await listMcpConnectionTokens(user.id);
  return c.json({ tokens });
});

mcpConnectionRoutes.post("/tokens", async (c) => {
  const user = requireUser(c);
  const token = await createMcpConnectionToken(user.id);
  return c.json(token, 201);
});

mcpConnectionRoutes.delete("/tokens/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  try {
    await revokeMcpConnectionToken(user.id, id);
  } catch {
    throw new HttpError(404, "token not found");
  }
  return c.body(null, 204);
});
