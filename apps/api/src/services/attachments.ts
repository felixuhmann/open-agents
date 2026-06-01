import { getAgentBackend } from "../agent-backend/instance.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

export type UploadedAttachment = {
  /** Backend file id used when mounting the attachment into the sandbox. */
  id: string;
  filename: string;
  mountPath: string;
  mime?: string;
  bytes?: Uint8Array;
};

function mimeFromContentType(ct: string): string {
  return ct.split(";")[0]?.trim() ?? "application/octet-stream";
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment";
}

/**
 * Upload every `EmailAttachment` row for `incomingMessageId` that doesn't
 * yet have a `backendFileId` to the agent backend's file store and
 * persist the resulting file id + mount path back onto the row.
 *
 * Idempotent: rows that already have a `backendFileId` are skipped, so
 * pg-boss retries don't re-upload anything.
 */
export async function uploadPendingAttachments(
  incomingMessageId: string,
): Promise<UploadedAttachment[]> {
  const pending = await prisma.emailAttachment.findMany({
    where: { emailMessageId: incomingMessageId, backendFileId: null },
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
    await prisma.emailAttachment.update({
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
    log.info("attachments: uploaded", {
      attachmentId: att.id,
      fileId: file.id,
      mountPath,
    });
  }
  return uploaded;
}
