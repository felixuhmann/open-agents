import { getAgentBackend } from "../agent-backend/instance.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { prepareAttachments, type UploadedAttachment } from "./attachmentResources.js";

/**
 * Build the mountable resources for a chat message's attachments, assigning a
 * backend file id to rows that do not have one yet.
 *
 * Every attachment on the message is returned — see `attachmentResources.ts`
 * for why an already-assigned id must not suppress materialization.
 */
export async function prepareChatAttachments(
  chatMessageId: string,
): Promise<UploadedAttachment[]> {
  const rows = await prisma.chatAttachment.findMany({
    where: { chatMessageId },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0) return [];

  const backend = await getAgentBackend();
  return prepareAttachments(
    rows.map((att) => ({ ...att, bytes: new Uint8Array(att.bytes) })),
    {
      uploadFile: (input) => backend.uploadFile(input),
      persist: async (attachmentId, backendFileId, mountPath) => {
        await prisma.chatAttachment.update({
          where: { id: attachmentId },
          data: { backendFileId, mountPath },
        });
        log.info("chat-attachments: uploaded", {
          attachmentId,
          fileId: backendFileId,
          mountPath,
        });
      },
    },
  );
}
