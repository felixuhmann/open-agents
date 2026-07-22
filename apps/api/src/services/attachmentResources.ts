import type {
  AgentFile,
  SessionResource,
  UploadFileInput,
} from "../agent-backend/types.js";

/**
 * Turning stored attachment rows into the resources a run mounts.
 *
 * The database bytes are authoritative. `backendFileId` is only a stable
 * label for the file — it is *not* evidence that the bytes are present in
 * any particular sandbox, and it must not gate materialization:
 *
 *  - a run that fails after the id was assigned retries with the id already
 *    set, and gating on it would hand the retry no attachments at all;
 *  - a sandbox created after a provider switch is a different, empty
 *    workspace, and gating on it would leave the user's files behind on the
 *    old provider.
 *
 * So every relevant run rebuilds its resources from the rows and writes them
 * to the same logical mount path, which is idempotent. Existing ids are
 * preserved so history keeps resolving.
 */

export type UploadedAttachment = {
  /** Backend file id used when mounting the attachment into the sandbox. */
  id: string;
  filename: string;
  mountPath: string;
  mime?: string;
  bytes?: Uint8Array;
};

/** The columns every attachment table shares. */
export type AttachmentRow = {
  id: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  backendFileId: string | null;
  mountPath: string | null;
};

export type PrepareAttachmentsDeps = {
  uploadFile: (input: UploadFileInput) => Promise<AgentFile>;
  /** Record a newly assigned file id and mount path on the row. */
  persist: (
    attachmentId: string,
    backendFileId: string,
    mountPath: string,
  ) => Promise<void>;
};

export function mimeFromContentType(ct: string): string {
  return ct.split(";")[0]?.trim() ?? "application/octet-stream";
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment";
}

export function attachmentMountPath(row: Pick<AttachmentRow, "filename" | "mountPath">) {
  return row.mountPath ?? `/workspace/inbox/${safeFilename(row.filename)}`;
}

/**
 * Build the mountable resources for a message's attachments, assigning a
 * backend file id to any row that does not have one yet.
 */
export async function prepareAttachments(
  rows: AttachmentRow[],
  deps: PrepareAttachmentsDeps,
): Promise<UploadedAttachment[]> {
  const prepared: UploadedAttachment[] = [];
  for (const row of rows) {
    const mountPath = attachmentMountPath(row);
    const mime = mimeFromContentType(row.contentType);
    let fileId = row.backendFileId;
    if (!fileId) {
      fileId = (await deps.uploadFile({ filename: row.filename, bytes: row.bytes, mime }))
        .id;
      await deps.persist(row.id, fileId, mountPath);
    }
    prepared.push({
      id: fileId,
      filename: row.filename,
      mountPath,
      mime,
      bytes: row.bytes,
    });
  }
  return prepared;
}

export function toSessionResources(prepared: UploadedAttachment[]): SessionResource[] {
  return prepared.map((f) => ({
    type: "file" as const,
    fileId: f.id,
    mountPath: f.mountPath,
    filename: f.filename,
    mime: f.mime,
    bytes: f.bytes,
  }));
}
