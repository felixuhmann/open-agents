import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import {
  prepareAttachments,
  toSessionResources,
  type PrepareAttachmentsDeps,
  type UploadedAttachment,
} from "./attachmentResources.js";

/**
 * Workflow attachment materialization. As elsewhere, every attachment on the
 * message is returned regardless of whether it already carries a backend file
 * id — see `attachmentResources.ts`.
 */

async function backendDeps(
  persist: PrepareAttachmentsDeps["persist"],
): Promise<PrepareAttachmentsDeps> {
  const backend = await getAgentBackend();
  return { uploadFile: (input) => backend.uploadFile(input), persist };
}

export async function prepareWorkflowAttachments(
  workflowMessageId: string,
): Promise<UploadedAttachment[]> {
  const rows = await prisma.workflowAttachment.findMany({
    where: { workflowMessageId },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0) return [];

  return prepareAttachments(
    rows.map((att) => ({ ...att, bytes: new Uint8Array(att.bytes) })),
    await backendDeps(async (attachmentId, backendFileId, mountPath) => {
      await prisma.workflowAttachment.update({
        where: { id: attachmentId },
        data: { backendFileId, mountPath },
      });
      log.info("workflow-attachments: uploaded", {
        attachmentId,
        fileId: backendFileId,
        mountPath,
      });
    }),
  );
}

export async function prepareWorkflowEmailAttachments(
  workflowEmailMessageId: string,
): Promise<UploadedAttachment[]> {
  const rows = await prisma.workflowEmailAttachment.findMany({
    where: { workflowEmailMessageId },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0) return [];

  return prepareAttachments(
    rows.map((att) => ({ ...att, bytes: new Uint8Array(att.bytes) })),
    await backendDeps(async (attachmentId, backendFileId, mountPath) => {
      await prisma.workflowEmailAttachment.update({
        where: { id: attachmentId },
        data: { backendFileId, mountPath },
      });
      log.info("workflow-email-attachments: uploaded", {
        attachmentId,
        fileId: backendFileId,
        mountPath,
      });
    }),
  );
}

export { toSessionResources as uploadedToSessionResources };

/**
 * User-uploaded chat files for the latest user message in a workflow
 * conversation, ready to mount into this step's sandbox.
 */
export async function loadWorkflowUserUploadResources(
  conversationId: string,
): Promise<SessionResource[]> {
  const lastUser = await prisma.workflowMessage.findFirst({
    where: { conversationId, role: "user" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!lastUser) return [];
  return toSessionResources(await prepareWorkflowAttachments(lastUser.id));
}
