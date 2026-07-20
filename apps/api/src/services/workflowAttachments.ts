import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
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
 * Upload pending workflow chat attachments for a user message. Idempotent.
 */
export async function uploadPendingWorkflowAttachments(
  workflowMessageId: string,
): Promise<UploadedAttachment[]> {
  const pending = await prisma.workflowAttachment.findMany({
    where: { workflowMessageId, backendFileId: null },
  });
  const uploaded: UploadedAttachment[] = [];
  if (pending.length === 0) return uploaded;

  const backend = getAgentBackend();
  for (const att of pending) {
    const mountPath = `/workspace/inbox/${safeFilename(att.filename)}`;
    const file = await backend.uploadFile({
      filename: att.filename,
      bytes: new Uint8Array(att.bytes),
      mime: mimeFromContentType(att.contentType),
    });
    await prisma.workflowAttachment.update({
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
    log.info("workflow-attachments: uploaded", {
      attachmentId: att.id,
      fileId: file.id,
      mountPath,
    });
  }
  return uploaded;
}

/**
 * Upload pending inbound email attachments for a workflow email message.
 */
export async function uploadPendingWorkflowEmailAttachments(
  workflowEmailMessageId: string,
): Promise<UploadedAttachment[]> {
  const pending = await prisma.workflowEmailAttachment.findMany({
    where: { workflowEmailMessageId, backendFileId: null },
  });
  const uploaded: UploadedAttachment[] = [];
  if (pending.length === 0) return uploaded;

  const backend = getAgentBackend();
  for (const att of pending) {
    const mountPath = `/workspace/inbox/${safeFilename(att.filename)}`;
    const file = await backend.uploadFile({
      filename: att.filename,
      bytes: new Uint8Array(att.bytes),
      mime: mimeFromContentType(att.contentType),
    });
    await prisma.workflowEmailAttachment.update({
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
    log.info("workflow-email-attachments: uploaded", {
      attachmentId: att.id,
      fileId: file.id,
      mountPath,
    });
  }
  return uploaded;
}

export function uploadedToSessionResources(
  uploaded: UploadedAttachment[],
): SessionResource[] {
  return uploaded.map((f) => ({
    type: "file" as const,
    fileId: f.id,
    mountPath: f.mountPath,
    filename: f.filename,
    mime: f.mime,
    bytes: f.bytes,
  }));
}

/**
 * Load user-uploaded chat files for the latest user message in a conversation.
 * Caller should upload pending rows first when preparing a run.
 */
export async function loadWorkflowUserUploadResources(
  conversationId: string,
): Promise<SessionResource[]> {
  const lastUser = await prisma.workflowMessage.findFirst({
    where: { conversationId, role: "user" },
    orderBy: { createdAt: "desc" },
    include: {
      attachments: { where: { backendFileId: { not: null } } },
    },
  });
  if (!lastUser || lastUser.attachments.length === 0) return [];

  return lastUser.attachments.map((att) => ({
    type: "file" as const,
    fileId: att.backendFileId!,
    mountPath: att.mountPath ?? `/workspace/inbox/${safeFilename(att.filename)}`,
    filename: att.filename,
    mime: mimeFromContentType(att.contentType),
    bytes: new Uint8Array(att.bytes),
  }));
}
