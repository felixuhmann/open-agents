import assert from "node:assert/strict";
import test from "node:test";
import type { McpOAuthSecrets } from "./mcpOAuthSecrets.js";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/open_agents?schema=public";
process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";
process.env.WEB_BASE_URL ??= "http://localhost:5173";
process.env.UPLOAD_SIGNING_SECRET ??= "test-upload-signing-secret-32-characters";
process.env.SECRET_ENCRYPTION_KEY ??=
  "0000000000000000000000000000000000000000000000000000000000000000";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-32-characters";

const { sealMcpOAuthSecrets, unsealMcpOAuthSecrets } =
  await import("./mcpOAuthSecrets.js");

const secrets: McpOAuthSecrets = {
  clientSecret: "google-client-secret",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  tokenType: "Bearer",
};

void test("OAuth MCP credentials round-trip through encrypted storage", () => {
  const sealed = sealMcpOAuthSecrets(secrets);
  assert.ok(!Buffer.from(sealed.encryptedValue).includes(Buffer.from("refresh-token")));
  assert.deepEqual(unsealMcpOAuthSecrets(sealed), secrets);
});
