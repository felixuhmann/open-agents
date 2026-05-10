import { Hono } from "hono";
import { z } from "zod";
import { getAgentBySlug } from "../../agents/service.js";
import { HttpError, requireAgentAccess, requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import { enqueueChatTurn } from "../../services/chat.js";

export const conversationsRoutes = new Hono<{ Variables: AppVariables }>();

const CreateConversationBody = z.object({
  agentSlug: z.string(),
  title: z.string().min(1).max(120).optional(),
});

const SendMessageBody = z.object({
  text: z.string().min(1).max(20000),
});

conversationsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const conversations = await prisma.chatConversation.findMany({
    where: { userId: user.id },
    include: {
      agent: { select: { id: true, slug: true, displayName: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
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
  const body = CreateConversationBody.parse(await c.req.json());
  const agent = await getAgentBySlug(body.agentSlug);
  if (!agent) throw new HttpError(404, "agent not found");
  if (!agent.webEnabled) throw new HttpError(400, "agent web chat is disabled");
  await requireAgentAccess(c, agent.id);

  const conv = await prisma.chatConversation.create({
    data: {
      agentId: agent.id,
      userId: user.id,
      title: body.title ?? "New chat",
    },
  });
  return c.json({
    id: conv.id,
    agentSlug: agent.slug,
    title: conv.title,
    createdAt: conv.createdAt.toISOString(),
  });
});

conversationsRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const conv = await prisma.chatConversation.findUnique({
    where: { id },
    include: {
      agent: { select: { id: true, slug: true, displayName: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  if (conv.userId !== user.id && user.role !== "admin") {
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
    })),
  });
});

conversationsRoutes.post("/:id/messages", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const body = SendMessageBody.parse(await c.req.json());
  const conv = await prisma.chatConversation.findUnique({
    where: { id },
    include: { agent: true },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  if (conv.userId !== user.id && user.role !== "admin") {
    throw new HttpError(403, "not your conversation");
  }
  if (!conv.agent.webEnabled) throw new HttpError(400, "web chat disabled");

  const userMessage = await prisma.chatMessage.create({
    data: {
      conversationId: conv.id,
      role: "user",
      content: body.text,
    },
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
