import {
  CreateConversationInput,
  SendConversationMessageInput,
} from "@open-agents/types";
import { Hono } from "hono";
import { getAgentBySlug } from "../../agents/service.js";
import {
  HttpError,
  canOperateAgents,
  requireAgentAccess,
  requireAgentOperator,
  requireUser,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import { enqueueChatTurn } from "../../services/chat.js";
import { getConversationTrace } from "../../services/sessionTrace.js";

export const conversationsRoutes = new Hono<{ Variables: AppVariables }>();

const DEFAULT_CONVERSATION_TITLE = "New chat";

function titleFromPrompt(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return DEFAULT_CONVERSATION_TITLE;
  return singleLine.slice(0, 120);
}

conversationsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const agentSlug = c.req.query("agentSlug");
  let agentId: string | undefined;
  if (agentSlug) {
    const agent = await getAgentBySlug(agentSlug);
    if (!agent) throw new HttpError(404, "agent not found");
    await requireAgentAccess(c, agent.id);
    agentId = agent.id;
  }
  const conversations = await prisma.chatConversation.findMany({
    where: { userId: user.id, ...(agentId ? { agentId } : {}) },
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: agentId ? 500 : 100,
  });
  return c.json({
    conversations: conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      agent: conv.agent,
      updatedAt: conv.updatedAt.toISOString(),
    })),
  });
});

conversationsRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const body = CreateConversationInput.parse(await c.req.json());
  const agent = await getAgentBySlug(body.agentSlug);
  if (!agent) throw new HttpError(404, "agent not found");
  if (!agent.webEnabled) throw new HttpError(400, "agent web chat is disabled");
  await requireAgentAccess(c, agent.id);

  const conv = await prisma.chatConversation.create({
    data: {
      agentId: agent.id,
      userId: user.id,
      title: body.title ?? titleFromPrompt(body.firstMessage ?? ""),
    },
  });
  return c.json({
    id: conv.id,
    agentSlug: agent.slug,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
  });
});

/**
 * Full agent trace for builders (admin/contributor). Same payload shape as
 * the issue detail viewer minus reporter/issue metadata.
 */
conversationsRoutes.get("/:id/trace", async (c) => {
  requireAgentOperator(c);
  const id = c.req.param("id");
  const trace = await getConversationTrace(id);
  return c.json(trace);
});

conversationsRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const conv = await prisma.chatConversation.findUnique({
    where: { id },
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
      messages: {
        where: { role: { in: ["user", "assistant", "system"] } },
        orderBy: { createdAt: "asc" },
        include: {
          attachments: {
            select: { id: true, filename: true, contentType: true, sizeBytes: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  if (conv.userId !== user.id && !canOperateAgents(user)) {
    throw new HttpError(403, "not your conversation");
  }
  return c.json({
    id: conv.id,
    title: conv.title,
    agent: conv.agent,
    messages: conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      runId: m.runId,
      createdAt: m.createdAt.toISOString(),
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    })),
  });
});

conversationsRoutes.post("/:id/messages", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const body = SendConversationMessageInput.parse(await c.req.json());
  const conv = await prisma.chatConversation.findUnique({
    where: { id },
    include: { agent: true },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  if (conv.userId !== user.id && !canOperateAgents(user)) {
    throw new HttpError(403, "not your conversation");
  }
  if (!conv.agent.webEnabled) throw new HttpError(400, "web chat disabled");

  // Pull any pending uploads (placeholder messages from
  // `POST /conversations/:id/attachments`) that the user staged before
  // sending and atomically reparent their ChatAttachments onto the real
  // user message so the run-agent worker actually picks them up.
  const userMessage = await prisma.$transaction(async (tx) => {
    const nextTitle =
      conv.title === DEFAULT_CONVERSATION_TITLE ? titleFromPrompt(body.text) : null;
    const pending = await tx.chatMessage.findMany({
      where: { conversationId: conv.id, role: "pending_user_upload" },
      include: { attachments: { select: { id: true } } },
    });

    const real = await tx.chatMessage.create({
      data: {
        conversationId: conv.id,
        role: "user",
        content: body.text,
      },
    });

    if (pending.length > 0) {
      const attachmentIds = pending.flatMap((m) => m.attachments.map((a) => a.id));
      if (attachmentIds.length > 0) {
        await tx.chatAttachment.updateMany({
          where: { id: { in: attachmentIds } },
          data: { chatMessageId: real.id },
        });
      }
      await tx.chatMessage.deleteMany({
        where: { id: { in: pending.map((m) => m.id) } },
      });
    }

    if (nextTitle) {
      await tx.chatConversation.update({
        where: { id: conv.id },
        data: { title: nextTitle },
      });
    }

    return real;
  });

  const runId = await enqueueChatTurn({
    conversationId: conv.id,
    userMessageId: userMessage.id,
  });

  await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { updatedAt: new Date() },
  });

  return c.json({
    messageId: userMessage.id,
    runId,
  });
});
