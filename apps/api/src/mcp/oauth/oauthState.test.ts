import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthState, derivePkceChallenge, verifyOAuthState } from "./oauthState.js";

const SECRET = "test-signing-secret-that-is-at-least-32-characters";

void test("OAuth state round-trips and binds the MCP server", () => {
  const state = createOAuthState({
    mcpServerId: "mcp_123",
    signingSecret: SECRET,
    nowMs: 1_000,
    nonce: "fixed-nonce",
  });

  assert.deepEqual(verifyOAuthState(state, { signingSecret: SECRET, nowMs: 2_000 }), {
    mcpServerId: "mcp_123",
    nonce: "fixed-nonce",
    expiresAtMs: 601_000,
  });
});

void test("OAuth state rejects tampering and expiry", () => {
  const state = createOAuthState({
    mcpServerId: "mcp_123",
    signingSecret: SECRET,
    nowMs: 1_000,
    nonce: "fixed-nonce",
  });

  assert.throws(
    () => verifyOAuthState(`${state}x`, { signingSecret: SECRET, nowMs: 2_000 }),
    /invalid oauth state/i,
  );
  assert.throws(
    () => verifyOAuthState(state, { signingSecret: SECRET, nowMs: 700_000 }),
    /expired/i,
  );
});

void test("PKCE challenge is deterministic for a signed state", () => {
  const first = derivePkceChallenge("signed-state", SECRET);
  const second = derivePkceChallenge("signed-state", SECRET);

  assert.equal(first.verifier, second.verifier);
  assert.equal(first.challenge, second.challenge);
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.challenge, /^[A-Za-z0-9_-]{43}$/);
});
