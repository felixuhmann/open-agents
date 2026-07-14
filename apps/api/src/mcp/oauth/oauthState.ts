import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1_000;

type OAuthStatePayload = {
  mcpServerId: string;
  nonce: string;
  expiresAtMs: number;
};

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signature(payload: string, signingSecret: string): string {
  return createHmac("sha256", signingSecret).update(payload).digest("base64url");
}

export function createOAuthState(input: {
  mcpServerId: string;
  signingSecret: string;
  nowMs?: number;
  nonce?: string;
}): string {
  const payload: OAuthStatePayload = {
    mcpServerId: input.mcpServerId,
    nonce: input.nonce ?? randomBytes(24).toString("base64url"),
    expiresAtMs: (input.nowMs ?? Date.now()) + STATE_TTL_MS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signature(encoded, input.signingSecret)}`;
}

export function verifyOAuthState(
  state: string,
  input: { signingSecret: string; nowMs?: number },
): OAuthStatePayload {
  const [encoded, suppliedSignature, ...extra] = state.split(".");
  if (!encoded || !suppliedSignature || extra.length > 0) {
    throw new Error("Invalid OAuth state");
  }

  const expected = Buffer.from(signature(encoded, input.signingSecret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Invalid OAuth state");
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as OAuthStatePayload;
  } catch {
    throw new Error("Invalid OAuth state");
  }
  if (
    !payload ||
    typeof payload.mcpServerId !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.expiresAtMs !== "number"
  ) {
    throw new Error("Invalid OAuth state");
  }
  if (payload.expiresAtMs <= (input.nowMs ?? Date.now())) {
    throw new Error("OAuth state expired");
  }
  return payload;
}

export function derivePkceChallenge(
  signedState: string,
  signingSecret: string,
): { verifier: string; challenge: string } {
  const verifier = createHmac("sha256", signingSecret)
    .update(`mcp-oauth-pkce:${signedState}`)
    .digest("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
