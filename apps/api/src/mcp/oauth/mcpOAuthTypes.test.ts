import assert from "node:assert/strict";
import test from "node:test";
import { CreateMcpServerInput, GOOGLE_DRIVE_MCP_PRESET } from "@open-agents/types";

void test("Google Drive preset is read-only and targets the official MCP endpoint", () => {
  assert.equal(
    GOOGLE_DRIVE_MCP_PRESET.serverUrl,
    "https://drivemcp.googleapis.com/mcp/v1",
  );
  assert.deepEqual(GOOGLE_DRIVE_MCP_PRESET.scopes, [
    "openid",
    "email",
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  const allowedTools = GOOGLE_DRIVE_MCP_PRESET.allowedTools.map(String);
  assert.ok(!allowedTools.includes("create_file"));
  assert.ok(!allowedTools.includes("copy_file"));
});

void test("OAuth MCP input requires Google client credentials", () => {
  const result = CreateMcpServerInput.safeParse({
    name: "google-drive",
    label: "Google Drive",
    serverUrl: GOOGLE_DRIVE_MCP_PRESET.serverUrl,
    authType: "oauth2",
  });

  assert.equal(result.success, false);
});

void test("OAuth MCP input accepts a least-privilege Google Drive connection", () => {
  const result = CreateMcpServerInput.safeParse({
    name: "google-drive",
    label: "Google Drive",
    serverUrl: GOOGLE_DRIVE_MCP_PRESET.serverUrl,
    authType: "oauth2",
    allowedTools: GOOGLE_DRIVE_MCP_PRESET.allowedTools,
    oauth: {
      provider: "google",
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret",
      scopes: GOOGLE_DRIVE_MCP_PRESET.scopes,
    },
  });

  assert.equal(result.success, true);
});
