import { Hono } from "hono";
import { z } from "zod";
import {
  HttpError,
  canOperateAgents,
  requireAgentOperator,
  requireUser,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import {
  createChatIssue,
  createEmailIssue,
  createWorkflowIssue,
  getIssueDetail,
  listIssues,
  setIssueStatus,
} from "../../services/issues.js";
import { verifyIssueReportToken } from "../../services/issueReportSigning.js";

export const issuesRoutes = new Hono<{ Variables: AppVariables }>();

const EmailReportBody = z.object({
  token: z.string().min(1),
  description: z.string().min(1).max(4000),
});

const CreateIssueBody = z
  .object({
    conversationId: z.string().min(1).optional(),
    workflowConversationId: z.string().min(1).optional(),
    description: z.string().min(1).max(4000),
  })
  .refine(
    (body) => Boolean(body.conversationId) !== Boolean(body.workflowConversationId),
    {
      message: "provide exactly one conversation id",
    },
  );

const PatchIssueBody = z.object({
  status: z.enum(["open", "resolved"]),
});

/**
 * Members file issues against their own chat conversations; admins see
 * everything. The email-surface report flow is the unauthenticated
 * `/api/issues/email-report` routes — email recipients have no cookie session.
 */
issuesRoutes.get("/email-report", async (c) => {
  const token = c.req.query("token");
  if (!token) throw new HttpError(400, "token is required");
  const verified = verifyIssueReportToken(token);
  if (!verified) throw new HttpError(400, "invalid or expired report link");
  const thread = await prisma.emailThread.findUnique({
    where: { id: verified.threadId },
    include: { agent: { select: { displayName: true } } },
  });
  if (!thread) throw new HttpError(404, "thread not found");
  return c.json({
    agentDisplayName: thread.agent.displayName,
    subject: thread.subject,
    reporterEmail: verified.email,
  });
});

issuesRoutes.post("/email-report", async (c) => {
  const body = EmailReportBody.parse(await c.req.json());
  const verified = verifyIssueReportToken(body.token);
  if (!verified) throw new HttpError(400, "invalid or expired report link");
  const created = await createEmailIssue({
    threadId: verified.threadId,
    reporterEmail: verified.email,
    description: body.description,
  });
  return c.json({ id: created.id });
});

issuesRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const body = CreateIssueBody.parse(await c.req.json());
  if (body.conversationId) {
    const conv = await prisma.chatConversation.findUnique({
      where: { id: body.conversationId },
      select: { userId: true },
    });
    if (!conv) throw new HttpError(404, "conversation not found");
    if (conv.userId !== user.id && !canOperateAgents(user)) {
      throw new HttpError(403, "not your conversation");
    }
    const created = await createChatIssue({
      conversationId: body.conversationId,
      reporterUserId: user.id,
      reporterEmail: user.email,
      description: body.description,
    });
    return c.json({ id: created.id });
  }

  const workflowConversationId = body.workflowConversationId!;
  const conv = await prisma.workflowConversation.findUnique({
    where: { id: workflowConversationId },
    select: { userId: true },
  });
  if (!conv) throw new HttpError(404, "workflow conversation not found");
  if (conv.userId !== user.id && !canOperateAgents(user)) {
    throw new HttpError(403, "not your workflow conversation");
  }
  const created = await createWorkflowIssue({
    conversationId: workflowConversationId,
    reporterUserId: user.id,
    reporterEmail: user.email,
    description: body.description,
  });
  return c.json({ id: created.id });
});

issuesRoutes.get("/", async (c) => {
  requireAgentOperator(c);
  const statusParam = c.req.query("status");
  const status =
    statusParam === "open" || statusParam === "resolved" ? statusParam : undefined;
  const issues = await listIssues({ status });
  return c.json({ issues });
});

issuesRoutes.get("/:id", async (c) => {
  requireAgentOperator(c);
  const id = c.req.param("id");
  const detail = await getIssueDetail(id);
  return c.json(detail);
});

issuesRoutes.patch("/:id", async (c) => {
  const user = requireAgentOperator(c);
  const id = c.req.param("id");
  const body = PatchIssueBody.parse(await c.req.json());
  await setIssueStatus({ id, status: body.status, resolverUserId: user.id });
  const detail = await getIssueDetail(id);
  return c.json(detail);
});
