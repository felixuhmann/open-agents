import { getAgentBackend } from "../agent-backend/instance.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import type { UploadedAttachment } from "./attachments.js";

function mimeFromContentType(ct: string): string {
  return ct.split(";")[0]?.trim() ?? "application/octet-stream";
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment";
}

/**
 * Upload every `ChatAttachment` row for `chatMessageId` that doesn't yet
 * have a `backendFileId` to the agent backend's file store and persist
 * the resulting file id + mount path back onto the row. Idempotent — pg-boss
 * retries don't re-upload.
 */
export async function uploadPendingChatAttachments(
  chatMessageId: string,
): Promise<UploadedAttachment[]> {
  const pending = await prisma.chatAttachment.findMany({
    where: { chatMessageId, backendFileId: null },
  });
  const uploaded: UploadedAttachment[] = [];
  if (pending.length === 0) return uploaded;

  const backend = await getAgentBackend();
  for (const att of pending) {
    const mountPath = `/workspace/inbox/${safeFilename(att.filename)}`;
    const file = await backend.uploadFile({
      filename: att.filename,
      bytes: new Uint8Array(att.bytes),
      mime: mimeFromContentType(att.contentType),
    });
    await prisma.chatAttachment.update({
      where: { id: att.id },
      data: { backendFileId: file.id, mountPath },
    });
    uploaded.push({
      id: file.id,
      filename: att.filename,
      mountPath,
      mime: mimeFromContentType(att.contentType),
      bytes: new Uint8Array(att.bytes),
    });
    log.info("chat-attachments: uploaded", {
      attachmentId: att.id,
      fileId: file.id,
      mountPath,
    });
  }
  return uploaded;
}
