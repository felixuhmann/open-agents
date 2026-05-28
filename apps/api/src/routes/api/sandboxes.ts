import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "../../auth/middleware.js";
import type { AppVariables } from "../../server/types.js";
import {
  archiveSandbox,
  deleteSandbox,
  getSandboxById,
  getSandboxForConversation,
  getSandboxForThread,
  listSandboxes,
  listUnregisteredDaytonaSandboxes,
  recoverSandbox,
  reconcileSandboxes,
  startSandbox,
  stopSandbox,
  syncSandboxFromProvider,
} from "../../services/sandboxes.js";

export const sandboxesRoutes = new Hono<{ Variables: AppVariables }>();

const ListQuery = z.object({
  agentId: z.string().optional(),
  state: z.string().optional(),
  surface: z.enum(["chat", "email"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

sandboxesRoutes.get("/", async (c) => {
  requireAdmin(c);
  const query = ListQuery.parse({
    agentId: c.req.query("agentId"),
    state: c.req.query("state"),
    surface: c.req.query("surface"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const result = await listSandboxes(query);
  return c.json(result);
});

sandboxesRoutes.get("/orphans", async (c) => {
  requireAdmin(c);
  const orphans = await listUnregisteredDaytonaSandboxes();
  return c.json({ orphans });
});

sandboxesRoutes.post("/reconcile", async (c) => {
  requireAdmin(c);
  const result = await reconcileSandboxes();
  return c.json(result);
});

sandboxesRoutes.get("/by-conversation/:conversationId", async (c) => {
  requireAdmin(c);
  const sandbox = await getSandboxForConversation(c.req.param("conversationId"));
  if (!sandbox) return c.json({ sandbox: null });
  return c.json({ sandbox });
});

sandboxesRoutes.get("/by-thread/:threadId", async (c) => {
  requireAdmin(c);
  const sandbox = await getSandboxForThread(c.req.param("threadId"));
  if (!sandbox) return c.json({ sandbox: null });
  return c.json({ sandbox });
});

sandboxesRoutes.get("/:id", async (c) => {
  requireAdmin(c);
  const sandbox = await getSandboxById(c.req.param("id"));
  if (!sandbox) return c.json({ error: "sandbox not found" }, 404);
  return c.json({ sandbox });
});

sandboxesRoutes.post("/:id/sync", async (c) => {
  requireAdmin(c);
  const sandbox = await syncSandboxFromProvider(c.req.param("id"));
  return c.json({ sandbox });
});

sandboxesRoutes.post("/:id/stop", async (c) => {
  requireAdmin(c);
  const sandbox = await stopSandbox(c.req.param("id"));
  return c.json({ sandbox });
});

sandboxesRoutes.post("/:id/start", async (c) => {
  requireAdmin(c);
  const sandbox = await startSandbox(c.req.param("id"));
  return c.json({ sandbox });
});

sandboxesRoutes.post("/:id/archive", async (c) => {
  requireAdmin(c);
  const sandbox = await archiveSandbox(c.req.param("id"));
  return c.json({ sandbox });
});

sandboxesRoutes.post("/:id/recover", async (c) => {
  requireAdmin(c);
  const sandbox = await recoverSandbox(c.req.param("id"));
  return c.json({ sandbox });
});

sandboxesRoutes.delete("/:id", async (c) => {
  requireAdmin(c);
  await deleteSandbox(c.req.param("id"));
  return c.json({ ok: true });
});
