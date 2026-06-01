import { prisma } from "../db.js";
import { log } from "../log.js";

/** Hard cap per run attachment (matches signed upload route). */
export const MAX_RUN_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type StoredRunAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

/**
 * Persist bytes returned from a run (sandbox curl upload or orchestrator pull).
 */
export async function storeRunAttachment(
  runId: string,
  filename: string,
  contentType: string,
  buf: Buffer,
  meta?: { reqId?: string },
): Promise<StoredRunAttachment> {
  if (buf.byteLength === 0) {
    throw new Error("empty file");
  }
  if (buf.byteLength > MAX_RUN_ATTACHMENT_BYTES) {
    throw new Error(`file too large (>${MAX_RUN_ATTACHMENT_BYTES} bytes)`);
  }

  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new Error(`unknown run: ${runId}`);
  }

  const row = await prisma.agentAttachment.create({
    data: {
      runId,
      filename,
      contentType,
      sizeBytes: buf.byteLength,
      bytes: new Uint8Array(buf),
    },
  });

  log.info("run-attachment: stored", {
    reqId: meta?.reqId,
    runId,
    attachmentId: row.id,
    filename,
    contentType,
    sizeBytes: buf.byteLength,
  });

  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  };
}
