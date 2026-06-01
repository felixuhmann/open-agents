import { File } from "node:buffer";
import { Hono } from "hono";
import { canOperateAgents, requireUser } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import type { AppVariables } from "../server/types.js";

/**
 * Chat upload routes are mounted at the app root so the SPA can post
 * conversation attachments without going through `/api`.
 */
export const UPLOAD_PREFIX = "/conversations";

export const uploadRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * 25 MB hard cap per upload — well under Mailgun's combined attachment
 * limit per message.
 */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Chat user upload: SPA POSTs a file the user attached to the next message
 * they're about to send. Cookie-authenticated and conversation-bound — the
 * caller must own the conversation (or be an admin).
 */
uploadRoutes.post("/conversations/:conversationId/attachments", async (c) => {
  const reqId = c.get("reqId");
  const user = requireUser(c);
  const conversationId = c.req.param("conversationId");

  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv) return c.text("unknown conversation", 404);
  if (conv.userId !== user.id && !canOperateAgents(user)) {
    return c.text("forbidden", 403);
  }

  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody({ all: false });
  } catch {
    return c.text("invalid multipart body", 400);
  }

  const file = form.file;
  if (!(file instanceof File)) return c.text("missing 'file' field", 400);
  if (file.size === 0) return c.text("empty file", 400);
  if (file.size > MAX_BYTES) return c.text("file too large", 413);

  const buf = Buffer.from(await file.arrayBuffer());
  // Placeholder ChatMessage so ChatAttachment has a parent; role is the
  // sentinel `pending_user_upload` so the conversations GET filter can hide
  // it and the next `POST /:id/messages` call can reparent its attachments
  // onto the actual user message before enqueuing the run.
  const placeholder = await prisma.chatMessage.create({
    data: {
      conversationId: conv.id,
      role: "pending_user_upload",
      content: file.name || "attachment",
    },
  });
  const row = await prisma.chatAttachment.create({
    data: {
      chatMessageId: placeholder.id,
      filename: file.name || "attachment",
      contentType: file.type || "application/octet-stream",
      sizeBytes: buf.byteLength,
      bytes: buf,
    },
  });

  log.info("chat upload: stored", {
    reqId,
    conversationId,
    chatMessageId: placeholder.id,
    chatAttachmentId: row.id,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
  });

  return c.json({
    chatMessageId: placeholder.id,
    chatAttachmentId: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  });
});
