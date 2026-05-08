import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * HMAC signature for the per-run sandbox upload URL we inject into the
 * agent's user message. The sandbox uses this URL to upload generated
 * files back to us so we can attach them to the email reply (or surface
 * them in chat).
 */
export function signRunUploadUrl(runId: string): string {
  return createHmac("sha256", config.UPLOAD_SIGNING_SECRET)
    .update(`run:${runId}`)
    .digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
