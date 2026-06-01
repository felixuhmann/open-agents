import { File } from "node:buffer";
import { Hono } from "hono";
import { canOperateAgents, requireUser } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import type { AppVariables } from "../server/types.js";
import { storeRunAttachment } from "../services/runAttachments.js";
import { safeEqualHex, signRunUploadUrl } from "../services/uploadSigning.js";

/**
 * Note: this router registers `/runs/:runId/attachments` and
 * `/conversations/:conversationId/attachments` (mounted at the root of the
 * app). The prefix below is only used by the request-log middleware to
 * recognize these paths as "interesting".
 */
export const UPLOAD_PREFIX = "/runs";

export const uploadRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * 25 MB hard cap per upload — well under Mailgun's combined attachment
 * limit per message.
 */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Sandbox-side upload: the agent's bash tool POSTs a file to the URL we
 * injected into its user message. Signed so a leaked URL only allows
 * adding attachments to a known runId (itself a CUID).
 */
uploadRoutes.post("/runs/:runId/attachments", async (c) => {
  const reqId = c.get("reqId");
  const runId = c.req.param("runId");
  const providedSig = c.req.query("sig") ?? "";

  const expected = signRunUploadUrl(runId);
  if (!safeEqualHex(providedSig, expected)) {
    log.warn("upload: bad signature", { reqId, runId });
    return c.text("invalid signature", 401);
  }

  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody({ all: false });
  } catch (err) {
    log.warn("upload: failed to parse body", {
      reqId,
      runId,
      err: err instanceof Error ? err.message : String(err),
    });
    return c.text("invalid multipart body", 400);
  }

  const file = form.file;
  if (!(file instanceof File)) {
    log.warn("upload: missing file field", {
      reqId,
      runId,
      keys: Object.keys(form),
    });
    return c.text("missing 'file' field", 400);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const filename = file.name || "attachment";
  const contentType = file.type || "application/octet-stream";

  let row;
  try {
    row = await storeRunAttachment(runId, filename, contentType, buf, { reqId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "empty file") return c.text("empty file", 400);
    if (message.startsWith("file too large")) {
      log.warn("upload: file too large", { reqId, runId, size: file.size });
      return c.text(message, 413);
    }
    if (message.startsWith("unknown run")) {
      log.warn("upload: unknown run", { reqId, runId });
      return c.text("unknown run", 404);
    }
    throw err;
  }

  return c.json({
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  });
});

/**
 * Chat user upload: SPA POSTs a file the user attached to the next message
 * they're about to send. Cookie-authenticated and conversation-bound — the
 * caller must own the conversation (or be an admin). No signature check
 * here because cookie auth already establishes the principal; the run-side
 * upload endpoint above keeps its HMAC because it's called from the
 * Anthropic sandbox without a browser session.
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
