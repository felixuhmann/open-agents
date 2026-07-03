import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";

/**
 * "Signed URL" tokens for out-of-band skill bundle uploads.
 *
 * The `skills_create` MCP tool can only speak JSON, so it can't carry a zip.
 * Instead it mints a {@link PendingSkillUpload} row and hands back a URL
 * containing an opaque, high-entropy token. The agent PUTs the bundle bytes to
 * that URL; {@link consumeSkillUploadToken} authenticates the request.
 *
 * We deliberately do NOT sign the token (no HMAC): the token is just random
 * bytes, and only its SHA-256 hash is stored — the boring, vetted "bearer token
 * hashed at rest" pattern (the same shape Better Auth uses for API keys). The DB
 * row is the source of truth, which makes single-use, expiry, and revocation
 * trivial.
 */

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CreatedSkillUpload = {
  id: string;
  /** Raw token — returned exactly once; never persisted. */
  token: string;
  expiresAt: Date;
};

/** Mint a pending upload authorization and return its one-time raw token. */
export async function createSkillUploadRequest(args: {
  skillName: string;
  description?: string | null;
  ttlMs?: number;
}): Promise<CreatedSkillUpload> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + (args.ttlMs ?? DEFAULT_TTL_MS));
  const row = await prisma.pendingSkillUpload.create({
    data: {
      tokenHash: hashToken(token),
      skillName: args.skillName,
      description: args.description ?? null,
      expiresAt,
    },
  });
  return { id: row.id, token, expiresAt };
}

export type VerifiedSkillUpload = {
  skillName: string;
  description: string | null;
};

/**
 * Authenticate a presented (id, token) pair without consuming it. Returns the
 * upload's metadata when the token matches a live (unconsumed, unexpired) row,
 * or null when the pair is unknown, mismatched, expired, or already used —
 * callers map null to 401 without leaking which it was. Read-only on purpose so
 * a subsequent client-side error (oversized/empty body) doesn't burn the token;
 * pair with {@link claimSkillUploadToken} to actually spend it.
 */
export async function verifySkillUploadToken(
  id: string,
  presentedToken: string,
): Promise<VerifiedSkillUpload | null> {
  const row = await prisma.pendingSkillUpload.findUnique({ where: { id } });
  if (!row) return null;

  // Constant-time compare of the fixed-length hashes (never the raw tokens).
  const expected = Buffer.from(row.tokenHash, "hex");
  const actual = Buffer.from(hashToken(presentedToken), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  if (row.consumedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return { skillName: row.skillName, description: row.description };
}

/**
 * Atomically mark the row consumed, guaranteeing single use. Returns true only
 * for the caller that flips `consumedAt` from null — so two concurrent PUTs
 * sharing a URL can't both create a version. Call only after a successful
 * {@link verifySkillUploadToken}, immediately before persisting the bundle.
 */
export async function claimSkillUploadToken(id: string): Promise<boolean> {
  const claimed = await prisma.pendingSkillUpload.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return claimed.count === 1;
}
