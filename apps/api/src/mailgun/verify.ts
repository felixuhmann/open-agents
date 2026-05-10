import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_field"
        | "timestamp_not_numeric"
        | "timestamp_skew_too_large"
        | "length_mismatch"
        | "hmac_mismatch";
      expected?: string;
      received?: string;
      ageSec?: number;
    };

/**
 * Verifies a Mailgun inbound webhook signature and returns a detailed result
 * suitable for debugging a misconfigured signing key.
 *
 * See https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store#securing-webhooks
 * The signature is `HMAC-SHA256(timestamp + token, signing_key)` in hex.
 */
export function verifyMailgunSignatureDetailed(
  params: { timestamp: string; token: string; signature: string },
  signingKey: string,
  maxClockSkewSeconds = 5 * 60,
): VerifyResult {
  const { timestamp, token, signature } = params;
  if (!timestamp || !token || !signature) {
    return { ok: false, reason: "missing_field" };
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: "timestamp_not_numeric" };
  }
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (ageSec > maxClockSkewSeconds) {
    return { ok: false, reason: "timestamp_skew_too_large", ageSec };
  }

  const expected = createHmac("sha256", signingKey)
    .update(timestamp + token)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) {
    return { ok: false, reason: "length_mismatch", expected, received: signature };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "hmac_mismatch", expected, received: signature };
  }
  return { ok: true };
}

export function verifyMailgunSignature(
  params: { timestamp: string; token: string; signature: string },
  signingKey: string,
  maxClockSkewSeconds = 5 * 60,
): boolean {
  return verifyMailgunSignatureDetailed(params, signingKey, maxClockSkewSeconds).ok;
}

/**
 * Short, non-reversible fingerprint for a secret: first 4 + last 4 of a
 * SHA-256 hex digest. Safe to log; useful to confirm which key is loaded.
 */
export function keyFingerprint(key: string): string {
  const hash = createHmac("sha256", "mailgun-signing-key-fingerprint-v1")
    .update(key)
    .digest("hex");
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}
