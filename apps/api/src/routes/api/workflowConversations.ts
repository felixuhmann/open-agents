import { Hono } from "hono";
import { z } from "zod";
import {
  HttpError,
  canOperateAgents,
  requireAgentOperator,
  requireUser,
  requireWorkflowAccess,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import { enqueueWorkflowTurn } from "../../services/workflowChat.js";
import { getWorkflowConversationTrace } from "../../services/workflowTrace.js";
import { getWorkflowBySlug } from "../../workflows/service.js";

export const workflowConversationsRoutes = new Hono<{ Variables: AppVariables }>();

const DEFAULT_TITLE = "New chat";

function titleFromPrompt(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return DEFAULT_TITLE;
  return singleLine.slice(0, 120);
}

const CreateBody = z.object({
  workflowSlug: z.string(),
  title: z.string().min(1).max(120).optional(),
  firstMessage: z.string().min(1).max(20000).optional(),
});

const SendBody = z.object({ text: z.string().min(1).max(20000) });

workflowConversationsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const workflowSlug = c.req.query("workflowSlug");
  let workflowId: string | undefined;
  if (workflowSlug) {
    const workflow = await getWorkflowBySlug(workflowSlug);
    if (!workflow) throw new HttpError(404, "workflow not found");
    await requireWorkflowAccess(c, workflow.id);
    workflowId = workflow.id;
  }
  const conversations = await prisma.workflowConversation.findMany({
    where: { userId: user.id, ...(workflowId ? { workflowId } : {}) },
    include: { workflow: { select: { id: true, slug: true, displayName: true } } },
    orderBy: { updatedAt: "desc" },
    take: workflowId ? 500 : 100,
  });
  return c.json({
    conversations: conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      workflow: conv.workflow,
      updatedAt: conv.updatedAt.toISOString(),
    })),
  });
});

workflowConversationsRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const body = CreateBody.parse(await c.req.json());
  const workflow = await getWorkflowBySlug(body.workflowSlug);
  if (!workflow) throw new HttpError(404, "workflow not found");
  if (!workflow.webEnabled) throw new HttpError(400, "workflow web chat is disabled");
  await requireWorkflowAccess(c, workflow.id);

  const conv = await prisma.workflowConversation.create({
    data: {
      workflowId: workflow.id,
      userId: user.id,
      title: body.title ?? titleFromPrompt(body.firstMessage ?? ""),
    },
  });
  return c.json({
    id: conv.id,
    workflowSlug: workflow.slug,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
  });
});

/**
 * Full workflow trace for builders (admin/contributor). Mirrors the agent
 * debug route but includes pipeline-level events and per-step agent runs.
 */
workflowConversationsRoutes.get("/:id/trace", async (c) => {
  requireAgentOperator(c);
  const id = c.req.param("id");
  const trace = await getWorkflowConversationTrace(id);
  return c.json(trace);
});

workflowConversationsRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const conv = await prisma.workflowConversation.findUnique({
    where: { id },
    include: {
      workflow: { select: { id: true, slug: true, displayName: true } },
      messages: { orderBy: { createdAt: "asc" } },
      runs: {
        where: { status: { in: ["pending", "running"] } },
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  if (conv.userId !== user.id && !canOperateAgents(user)) {
    throw new HttpError(403, "not your conversation");
  }
  const workflowRunIds = conv.messages
    .map((m) => m.workflowRunId)
    .filter((id): id is string => id != null);
  const finalStepRuns =
    workflowRunIds.length > 0
      ? await prisma.workflowStepRun.findMany({
          where: {
            workflowRunId: { in: workflowRunIds },
            status: "succeeded",
            runId: { not: null },
          },
          orderBy: { position: "desc" },
          select: { workflowRunId: true, runId: true },
        })
      : [];
  const agentRunIdByWorkflowRun = new Map<string, string>();
  for (const step of finalStepRuns) {
    if (step.runId && !agentRunIdByWorkflowRun.has(step.workflowRunId)) {
      agentRunIdByWorkflowRun.set(step.workflowRunId, step.runId);
    }
  }

  return c.json({
    id: conv.id,
    title: conv.title,
    workflow: conv.workflow,
    activeWorkflowRunId: conv.runs[0]?.id ?? null,
    messages: conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      workflowRunId: m.workflowRunId,
      agentRunId:
        m.agentRunId ??
        (m.workflowRunId ? (agentRunIdByWorkflowRun.get(m.workflowRunId) ?? null) : null),
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

workflowConversationsRoutes.post("/:id/messages", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const body = SendBody.parse(await c.req.json());
  const conv = await prisma.workflowConversation.findUnique({
    where: { id },
    include: { workflow: true },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  if (conv.userId !== user.id && !canOperateAgents(user)) {
    throw new HttpError(403, "not your conversation");
  }
  if (!conv.workflow.webEnabled) throw new HttpError(400, "web chat disabled");

  const userMessage = await prisma.$transaction(async (tx) => {
    const nextTitle = conv.title === DEFAULT_TITLE ? titleFromPrompt(body.text) : null;
    const real = await tx.workflowMessage.create({
      data: { conversationId: conv.id, role: "user", content: body.text },
    });
    if (nextTitle) {
      await tx.workflowConversation.update({
        where: { id: conv.id },
        data: { title: nextTitle },
      });
    }
    return real;
  });

  const workflowRunId = await enqueueWorkflowTurn({ conversationId: conv.id });

  await prisma.workflowConversation.update({
    where: { id: conv.id },
    data: { updatedAt: new Date() },
  });

  return c.json({ messageId: userMessage.id, workflowRunId });
});
