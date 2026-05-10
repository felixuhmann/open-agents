/**
 * Helpers for pulling attachments out of Mailgun inbound webhook form data.
 *
 * Mailgun posts attachments as multipart fields named `attachment-1`,
 * `attachment-2`, etc. With Hono's `c.req.parseBody({ all: true })` we get
 * these as `File` objects (or arrays of them).
 */
export type ParsedAttachment = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

export async function parseAttachments(
  form: Record<string, unknown>,
): Promise<ParsedAttachment[]> {
  const attachments: ParsedAttachment[] = [];
  for (const [key, value] of Object.entries(form)) {
    if (!key.startsWith("attachment-")) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (!isFile(v)) continue;
      const buf = new Uint8Array(await v.arrayBuffer());
      attachments.push({
        filename: v.name || key,
        contentType: v.type || "application/octet-stream",
        sizeBytes: buf.byteLength,
        bytes: buf,
      });
    }
  }
  return attachments;
}

function isFile(v: unknown): v is File {
  return (
    typeof v === "object" && v !== null && typeof (v as File).arrayBuffer === "function"
  );
}
