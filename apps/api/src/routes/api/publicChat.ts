import { File } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RunEventEnvelope } from "@open-agents/types";
import { SendConversationMessageInput } from "@open-agents/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { HttpError } from "../../auth/middleware.js";
import { parseStarterPrompts } from "../../agents/starterPrompts.js";
import { prisma } from "../../db.js";
import { log } from "../../log.js";
import { isTerminalEvent, readBacklog, subscribe } from "../../runs/events.js";
import type { AppVariables } from "../../server/types.js";
import { enqueueChatTurn } from "../../services/chat.js";
import { requestAgentRunCancellation } from "../../services/runCancellation.js";

export const publicChatRoutes = new Hono<{ Variables: AppVariables }>();

const DEFAULT_CONVERSATION_TITLE = "New chat";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function titleFromPrompt(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine ? singleLine.slice(0, 120) : DEFAULT_CONVERSATION_TITLE;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokensEqual(left: string | null, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireQueryToken(
  c: { req: { query(name: string): string | undefined } },
  name: string,
) {
  const token = c.req.query(name)?.trim();
  if (!token || token.length > 256) throw new HttpError(404, "share link not found");
  return token;
}

async function requireSharedAgent(slug: string, shareToken: string) {
  const agent = await prisma.agent.findUnique({ where: { slug } });
  if (
    !agent ||
    !agent.webEnabled ||
    !agent.currentVersionId ||
    !tokensEqual(agent.publicShareToken, shareToken)
  ) {
    throw new HttpError(404, "share link not found");
  }
  return agent;
}

async function requirePublicConversation(
  conversationId: string,
  shareToken: string,
  accessToken: string,
) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: { agent: true },
  });
  if (!conversation) throw new HttpError(404, "public conversation not found");
  if (
    conversation.userId !== null ||
    !conversation.publicAccessTokenHash ||
    !tokensEqual(conversation.agent.publicShareToken, shareToken) ||
    !conversation.agent.webEnabled ||
    !conversation.agent.currentVersionId ||
    !tokensEqual(conversation.publicAccessTokenHash, hashToken(accessToken))
  ) {
    throw new HttpError(404, "public conversation not found");
  }
  return conversation;
}

function conversationDto(
  conversation: Awaited<ReturnType<typeof requirePublicConversation>>,
  messages: Array<{
    id: string;
    role: string;
    content: string;
    runId: string | null;
    createdAt: Date;
    attachments: Array<{
      id: string;
      filename: string;
      contentType: string;
      sizeBytes: number;
    }>;
  }>,
) {
  return {
    id: conversation.id,
    title: conversation.title,
    agent: {
      id: conversation.agent.id,
      slug: conversation.agent.slug,
      displayName: conversation.agent.displayName,
      avatar: conversation.agent.avatar,
    },
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      runId: message.runId,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments,
    })),
  };
}

publicChatRoutes.get("/agents/:slug", async (c) => {
  const token = requireQueryToken(c, "token");
  const agent = await requireSharedAgent(c.req.param("slug"), token);
  c.header("cache-control", "no-store");
  return c.json({
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    avatar: agent.avatar,
    starterPrompts: parseStarterPrompts(agent.starterPrompts),
  });
});

publicChatRoutes.post("/agents/:slug/conversations", async (c) => {
  const token = requireQueryToken(c, "token");
  const agent = await requireSharedAgent(c.req.param("slug"), token);
  const accessToken = randomBytes(32).toString("base64url");
  const conversation = await prisma.chatConversation.create({
    data: {
      agentId: agent.id,
      userId: null,
      publicAccessTokenHash: hashToken(accessToken),
    },
  });
  return c.json({ conversationId: conversation.id, accessToken });
});

publicChatRoutes.get("/conversations/:id", async (c) => {
  const shareToken = requireQueryToken(c, "token");
  const accessToken = requireQueryToken(c, "access_token");
  const conversation = await requirePublicConversation(
    c.req.param("id"),
    shareToken,
    accessToken,
  );
  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId: conversation.id,
      role: { in: ["user", "assistant", "system"] },
    },
    orderBy: { createdAt: "asc" },
    include: {
      attachments: {
        select: { id: true, filename: true, contentType: true, sizeBytes: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  c.header("cache-control", "no-store");
  return c.json(conversationDto(conversation, messages));
});

publicChatRoutes.post("/conversations/:id/messages", async (c) => {
  const shareToken = requireQueryToken(c, "token");
  const accessToken = requireQueryToken(c, "access_token");
  const body = SendConversationMessageInput.parse(await c.req.json());
  const conversation = await requirePublicConversation(
    c.req.param("id"),
    shareToken,
    accessToken,
  );

  const userMessage = await prisma.$transaction(async (tx) => {
    const pending = await tx.chatMessage.findMany({
      where: { conversationId: conversation.id, role: "pending_user_upload" },
      include: { attachments: { select: { id: true } } },
    });
    const real = await tx.chatMessage.create({
      data: { conversationId: conversation.id, role: "user", content: body.text },
    });
    const attachmentIds = pending.flatMap((message) =>
      message.attachments.map((attachment) => attachment.id),
    );
    if (attachmentIds.length > 0) {
      await tx.chatAttachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { chatMessageId: real.id },
      });
    }
    if (pending.length > 0) {
      await tx.chatMessage.deleteMany({
        where: { id: { in: pending.map((message) => message.id) } },
      });
    }
    await tx.chatConversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: new Date(),
        ...(conversation.title === DEFAULT_CONVERSATION_TITLE
          ? { title: titleFromPrompt(body.text) }
          : {}),
      },
    });
    return real;
  });

  const runId = await enqueueChatTurn({
    conversationId: conversation.id,
    userMessageId: userMessage.id,
  });
  return c.json({ messageId: userMessage.id, runId });
});

publicChatRoutes.post("/conversations/:id/attachments", async (c) => {
  const shareToken = requireQueryToken(c, "token");
  const accessToken = requireQueryToken(c, "access_token");
  const conversation = await requirePublicConversation(
    c.req.param("id"),
    shareToken,
    accessToken,
  );
  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody({ all: false });
  } catch {
    throw new HttpError(400, "invalid multipart body");
  }
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "missing 'file' field");
  if (file.size === 0) throw new HttpError(400, "empty file");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "file too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  const placeholder = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: "pending_user_upload",
      content: file.name || "attachment",
    },
  });
  const attachment = await prisma.chatAttachment.create({
    data: {
      chatMessageId: placeholder.id,
      filename: file.name || "attachment",
      contentType: file.type || "application/octet-stream",
      sizeBytes: bytes.byteLength,
      bytes,
    },
  });
  return c.json({
    chatMessageId: placeholder.id,
    chatAttachmentId: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
  });
});

async function requirePublicRun(
  conversationId: string,
  runId: string,
  shareToken: string,
  accessToken: string,
) {
  const conversation = await requirePublicConversation(
    conversationId,
    shareToken,
    accessToken,
  );
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "run not found");
  if (run.conversationId !== conversation.id || run.surface !== "chat") {
    throw new HttpError(404, "run not found");
  }
  return run;
}

publicChatRoutes.post("/conversations/:id/runs/:runId/stop", async (c) => {
  const shareToken = requireQueryToken(c, "token");
  const accessToken = requireQueryToken(c, "access_token");
  const runId = c.req.param("runId");
  await requirePublicRun(c.req.param("id"), runId, shareToken, accessToken);
  const status = await requestAgentRunCancellation(runId);
  return c.json({ runId, status });
});

publicChatRoutes.get("/conversations/:id/runs/:runId/events", async (c) => {
  const shareToken = requireQueryToken(c, "token");
  const accessToken = requireQueryToken(c, "access_token");
  const runId = c.req.param("runId");
  await requirePublicRun(c.req.param("id"), runId, shareToken, accessToken);
  const rawAfter = c.req.header("last-event-id") ?? c.req.query("lastEventId");
  const afterSeq = rawAfter ? Number(rawAfter) : 0;

  return streamSSE(c, async (stream) => {
    let stopped = false;
    const send = async (event: RunEventEnvelope) => {
      await stream.writeSSE({
        id: String(event.seq),
        event: event.type,
        data: JSON.stringify(event),
      });
    };
    const queue: RunEventEnvelope[] = [];
    let live = false;
    const unsubscribe = subscribe(runId, (event) => {
      if (!live) {
        queue.push(event);
        return;
      }
      void send(event)
        .then(() => {
          if (isTerminalEvent(event)) {
            stopped = true;
            unsubscribe();
            void stream.close();
          }
        })
        .catch((error) =>
          log.warn("public chat: SSE write failed", { runId, err: String(error) }),
        );
    });

    try {
      const backlog = await readBacklog(runId, Number.isFinite(afterSeq) ? afterSeq : 0);
      for (const event of backlog) {
        if (stopped) return;
        await send(event);
        if (isTerminalEvent(event)) {
          unsubscribe();
          return;
        }
      }
      live = true;
      while (queue.length > 0) {
        const event = queue.shift();
        if (!event) continue;
        if (event.seq <= (backlog[backlog.length - 1]?.seq ?? afterSeq)) continue;
        await send(event);
        if (isTerminalEvent(event)) {
          unsubscribe();
          return;
        }
      }
      const refreshed = await prisma.agentRun.findUnique({ where: { id: runId } });
      if (
        refreshed?.status === "succeeded" ||
        refreshed?.status === "failed" ||
        refreshed?.status === "cancelled"
      ) {
        unsubscribe();
        return;
      }
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    } catch (error) {
      log.warn("public chat: SSE handler failed", { runId, err: String(error) });
      unsubscribe();
    }
  });
});

publicChatRoutes.get("/conversations/:id/runs/:runId/attachments", async (c) => {
  const shareToken = requireQueryToken(c, "token");
  const accessToken = requireQueryToken(c, "access_token");
  const runId = c.req.param("runId");
  await requirePublicRun(c.req.param("id"), runId, shareToken, accessToken);
  const attachments = await prisma.agentAttachment.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });
  return c.json({
    attachments: attachments.map((attachment) => ({
      ...attachment,
      createdAt: attachment.createdAt.toISOString(),
    })),
  });
});

publicChatRoutes.get(
  "/conversations/:id/runs/:runId/attachments/:attachmentId",
  async (c) => {
    const shareToken = requireQueryToken(c, "token");
    const accessToken = requireQueryToken(c, "access_token");
    const runId = c.req.param("runId");
    await requirePublicRun(c.req.param("id"), runId, shareToken, accessToken);
    const attachment = await prisma.agentAttachment.findUnique({
      where: { id: c.req.param("attachmentId") },
    });
    if (!attachment) throw new HttpError(404, "attachment not found");
    if (attachment.runId !== runId) {
      throw new HttpError(404, "attachment not found");
    }
    c.header("content-type", attachment.contentType || "application/octet-stream");
    c.header("content-length", String(attachment.sizeBytes));
    const safeName = attachment.filename.replace(/[^\w.\- ]+/g, "_") || "attachment";
    c.header("content-disposition", `attachment; filename="${safeName}"`);
    c.header("cache-control", "private, max-age=0, must-revalidate");
    return c.body(new Uint8Array(attachment.bytes));
  },
);
