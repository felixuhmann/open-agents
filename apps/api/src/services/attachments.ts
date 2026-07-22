import { getAgentBackend } from "../agent-backend/instance.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { prepareAttachments, type UploadedAttachment } from "./attachmentResources.js";

/**
 * Build the mountable resources for an inbound email message's attachments,
 * assigning a backend file id to rows that do not have one yet.
 *
 * Every attachment on the message is returned, not just the newly uploaded
 * ones: the bytes have to reach whichever sandbox this run uses, which is a
 * fresh empty one after a provider switch and possibly a re-mount on a
 * retry. See `attachmentResources.ts`.
 */
export async function prepareEmailAttachments(
  incomingMessageId: string,
): Promise<UploadedAttachment[]> {
  const rows = await prisma.emailAttachment.findMany({
    where: { emailMessageId: incomingMessageId },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0) return [];

  const backend = await getAgentBackend();
  const prepared = await prepareAttachments(
    rows.map((att) => ({ ...att, bytes: new Uint8Array(att.bytes) })),
    {
      uploadFile: (input) => backend.uploadFile(input),
      persist: async (attachmentId, backendFileId, mountPath) => {
        await prisma.emailAttachment.update({
          where: { id: attachmentId },
          data: { backendFileId, mountPath },
        });
        log.info("attachments: uploaded", {
          attachmentId,
          fileId: backendFileId,
          mountPath,
        });
      },
    },
  );
  return prepared;
}
