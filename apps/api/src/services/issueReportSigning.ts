import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * HMAC-signed token embedded in the "Report this conversation" link we
 * inject into outbound agent emails. Email recipients aren't necessarily
 * SPA users (no cookie session), so we authenticate the report submission
 * by handing them a one-shot signed token that names the EmailThread plus
 * the recipient address it was issued to.
 *
 * The token is `<base64url(payload)>.<hex hmac>`. Payload encodes:
 *   - `t`: threadId
 *   - `e`: lower-cased recipient email
 *   - `x`: expiry (epoch seconds)
 *
 * Default lifetime is 30 days — generous because the user might forward
 * the email and click weeks later. Anyone in possession of the email can
 * already report it; the signature only stops third parties from forging
 * arbitrary thread/email combinations.
 */

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

type TokenPayload = {
  t: string;
  e: string;
  x: number;
};

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmacHex(payload: string): string {
  return createHmac("sha256", config.UPLOAD_SIGNING_SECRET)
    .update(`issue-report:${payload}`)
    .digest("hex");
}

export function signIssueReportToken(args: {
  threadId: string;
  email: string;
  ttlSeconds?: number;
}): string {
  const ttl = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const payload: TokenPayload = {
    t: args.threadId,
    e: args.email.trim().toLowerCase(),
    x: Math.floor(Date.now() / 1000) + ttl,
  };
  const encoded = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = hmacHex(encoded);
  return `${encoded}.${sig}`;
}

export type VerifiedIssueReportToken = {
  threadId: string;
  email: string;
};

export function verifyIssueReportToken(token: string): VerifiedIssueReportToken | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmacHex(encoded);
  if (sig.length !== expected.length) return null;
  let ok: boolean;
  try {
    ok = timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded).toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.t !== "string" || typeof payload.e !== "string") return null;
  if (typeof payload.x !== "number" || payload.x < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { threadId: payload.t, email: payload.e };
}

/**
 * Build the absolute URL email recipients click to file an issue. Includes
 * the signed token as a query string so the public route can verify the
 * caller without a cookie session.
 */
export function buildIssueReportUrl(args: { threadId: string; email: string }): string {
  const token = signIssueReportToken(args);
  return `${config.PUBLIC_BASE_URL}/issues/report?token=${encodeURIComponent(token)}`;
}
