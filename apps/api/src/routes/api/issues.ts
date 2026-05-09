import { Hono } from "hono";
import { z } from "zod";
import { HttpError, requireAdmin, requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import {
  createChatIssue,
  getIssueDetail,
  listIssues,
  setIssueStatus,
} from "../../services/issues.js";

export const issuesRoutes = new Hono<{ Variables: AppVariables }>();

const CreateChatIssueBody = z.object({
  conversationId: z.string().min(1),
  description: z.string().min(1).max(4000),
});

const PatchIssueBody = z.object({
  status: z.enum(["open", "resolved"]),
});

/**
 * Members file issues against their own chat conversations; admins see
 * everything. The email-surface report flow lives on the unauthenticated
 * `/issues/report` route — those callers don't have a cookie session.
 */
issuesRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const body = CreateChatIssueBody.parse(await c.req.json());
  const conv = await prisma.chatConversation.findUnique({
    where: { id: body.conversationId },
    select: { userId: true },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  if (conv.userId !== user.id && user.role !== "admin") {
    throw new HttpError(403, "not your conversation");
  }
  const created = await createChatIssue({
    conversationId: body.conversationId,
    reporterUserId: user.id,
    reporterEmail: user.email,
    description: body.description,
  });
  return c.json({ id: created.id });
});

issuesRoutes.get("/", async (c) => {
  requireAdmin(c);
  const statusParam = c.req.query("status");
  const status =
    statusParam === "open" || statusParam === "resolved" ? statusParam : undefined;
  const issues = await listIssues({ status });
  return c.json({ issues });
});

issuesRoutes.get("/:id", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");
  const detail = await getIssueDetail(id);
  return c.json(detail);
});

issuesRoutes.patch("/:id", async (c) => {
  const user = requireAdmin(c);
  const id = c.req.param("id");
  const body = PatchIssueBody.parse(await c.req.json());
  await setIssueStatus({ id, status: body.status, resolverUserId: user.id });
  const detail = await getIssueDetail(id);
  return c.json(detail);
});
