import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentBackendError } from "../../agent-backend/types.js";
import { readBrokerToken, resolveBrokerConfig } from "./config.js";

/**
 * Broker deployment configuration.
 *
 * The token is a server-side secret: it comes from the environment or a
 * mounted file, never from the database and never from the browser.
 */

const LIMITS = {
  SANDBOX_BROKER_CPU_CORES: 2,
  SANDBOX_BROKER_MEMORY_MIB: 2048,
  SANDBOX_BROKER_PIDS: 512,
  SANDBOX_BROKER_WORKSPACE_MIB: 4096,
};

void test("broker config: absent URL means the provider is simply not configured", async () => {
  assert.equal(await resolveBrokerConfig({ ...LIMITS }), null);
});

void test("broker config: a URL with no token is a misconfiguration, not a silent skip", async () => {
  await assert.rejects(
    resolveBrokerConfig({ ...LIMITS, SANDBOX_BROKER_URL: "http://sandbox-broker:8080" }),
    (err: unknown) => {
      assert.ok(err instanceof AgentBackendError);
      assert.match(err.message, /SANDBOX_BROKER_TOKEN/);
      return true;
    },
  );
});

void test("broker config: an inline token produces a usable config with the deployment limits", async () => {
  const resolved = await resolveBrokerConfig({
    ...LIMITS,
    SANDBOX_BROKER_URL: "http://sandbox-broker:8080/",
    SANDBOX_BROKER_TOKEN: "s3cret-token-value",
  });
  assert.ok(resolved);
  assert.equal(resolved.baseUrl, "http://sandbox-broker:8080");
  assert.equal(resolved.token, "s3cret-token-value");
  assert.deepEqual(resolved.limits, {
    cpuCores: 2,
    memoryMiB: 2048,
    pids: 512,
    workspaceMiB: 4096,
  });
});

void test("broker config: a token file is read and trimmed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "broker-token-"));
  const file = join(dir, "token");
  writeFileSync(file, "file-token-value\n", { mode: 0o600 });

  const resolved = await resolveBrokerConfig({
    ...LIMITS,
    SANDBOX_BROKER_URL: "http://sandbox-broker:8080",
    SANDBOX_BROKER_TOKEN_FILE: file,
  });
  assert.equal(resolved?.token, "file-token-value");
});

void test("broker config: an unreadable token file reports the path, not the contents", async () => {
  await assert.rejects(
    readBrokerToken({ SANDBOX_BROKER_TOKEN_FILE: "/nope/does-not-exist" }),
    (err: unknown) => {
      assert.ok(err instanceof AgentBackendError);
      assert.match(err.message, /\/nope\/does-not-exist/);
      return true;
    },
  );
});

void test("broker config: an empty token file is rejected rather than used", async () => {
  const dir = mkdtempSync(join(tmpdir(), "broker-token-"));
  const file = join(dir, "token");
  writeFileSync(file, "   \n");
  await assert.rejects(readBrokerToken({ SANDBOX_BROKER_TOKEN_FILE: file }), /empty/i);
});

void test("broker config: the inline token wins over a token file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "broker-token-"));
  const file = join(dir, "token");
  writeFileSync(file, "file-token-value");
  const token = await readBrokerToken({
    SANDBOX_BROKER_TOKEN: "inline-token",
    SANDBOX_BROKER_TOKEN_FILE: file,
  });
  assert.equal(token, "inline-token");
});

void test("broker config: a pinned broker version is carried through", async () => {
  const resolved = await resolveBrokerConfig({
    ...LIMITS,
    SANDBOX_BROKER_URL: "http://sandbox-broker:8080",
    SANDBOX_BROKER_TOKEN: "t",
    SANDBOX_BROKER_EXPECTED_VERSION: "0.1.0-rc.1",
  });
  assert.equal(resolved?.expectedBrokerVersion, "0.1.0-rc.1");
});
