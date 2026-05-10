import { File } from "node:buffer";
import { Hono } from "hono";
import { requireUser } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import type { AppVariables } from "../server/types.js";
import {
  safeEqualHex,
  signChatUploadUrl,
  signRunUploadUrl,
} from "../services/uploadSigning.js";

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

  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) {
    log.warn("upload: unknown run", { reqId, runId });
    return c.text("unknown run", 404);
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

  if (file.size === 0) return c.text("empty file", 400);
  if (file.size > MAX_BYTES) {
    log.warn("upload: file too large", { reqId, runId, size: file.size });
    return c.text(`file too large (>${MAX_BYTES} bytes)`, 413);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const filename = file.name || "attachment";
  const contentType = file.type || "application/octet-stream";

  const row = await prisma.agentAttachment.create({
    data: {
      runId,
      filename,
      contentType,
      sizeBytes: buf.byteLength,
      bytes: buf,
    },
  });

  log.info("upload: stored", {
    reqId,
    runId,
    attachmentId: row.id,
    filename,
    contentType,
    sizeBytes: buf.byteLength,
  });

  return c.json({
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  });
});

/**
 * Chat user upload: SPA POSTs a file the user attached to the next message
 * they're about to send. Cookie-authenticated and conversation-bound; the
 * `sig` query is a defence-in-depth check so the same URL can be reused if
 * we move uploads behind a different proxy later.
 */
uploadRoutes.post("/conversations/:conversationId/attachments", async (c) => {
  const reqId = c.get("reqId");
  const user = requireUser(c);
  const conversationId = c.req.param("conversationId");
  const providedSig = c.req.query("sig") ?? "";

  const expected = signChatUploadUrl(conversationId);
  if (!safeEqualHex(providedSig, expected)) {
    return c.text("invalid signature", 401);
  }

  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv) return c.text("unknown conversation", 404);
  if (conv.userId !== user.id && user.role !== "admin") {
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
  const placeholder = await prisma.chatMessage.create({
    data: {
      conversationId: conv.id,
      role: "user",
      content: `[attachment placeholder] ${file.name || "attachment"}`,
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
