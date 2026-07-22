import assert from "node:assert/strict";
import test from "node:test";
// Type-only: erased at runtime, so importing it does not trigger the module's
// top-level load() before each case has set its environment.
import type { Config } from "./config.js";

/**
 * Environment parsing, exercised the way Compose actually delivers it.
 *
 * `${SANDBOX_BROKER_URL:-}` in a Compose file sets the variable to an *empty
 * string* rather than leaving it unset, so "optional" has to mean "absent or
 * empty" or a Daytona deployment that never opted into the broker fails to
 * boot at all.
 */

const REQUIRED = {
  DATABASE_URL: "postgresql://postgres:postgres@db:5432/open_agents?schema=public",
  PUBLIC_BASE_URL: "http://localhost:3000",
  WEB_BASE_URL: "http://localhost:3000",
  UPLOAD_SIGNING_SECRET: "u".repeat(40),
  SECRET_ENCRYPTION_KEY: "0".repeat(64),
  BETTER_AUTH_SECRET: "b".repeat(40),
};

/**
 * Load a fresh copy of the config module under a given environment.
 *
 * Every `SANDBOX_BROKER_*` variable is cleared first, so a developer running
 * the broker integration suite (which exports some of them) does not change
 * what these cases are asserting.
 */
async function loadConfig(env: Record<string, string>): Promise<Config> {
  const previous = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SANDBOX_BROKER_")) delete process.env[key];
  }
  Object.assign(process.env, REQUIRED, env);
  try {
    // Cache-busting query so each case re-runs the module's top-level load().
    const module = (await import(`./config.js?case=${Math.random()}`)) as {
      config: Config;
    };
    return module.config;
  } finally {
    process.env = previous;
  }
}

void test("config: a deployment with no broker variables at all loads", async () => {
  const config = await loadConfig({});
  assert.equal(config.SANDBOX_BROKER_URL, undefined);
  assert.equal(config.SANDBOX_BROKER_TOKEN, undefined);
});

void test("config: empty broker variables are treated as absent, not invalid", async () => {
  // Exactly what `${SANDBOX_BROKER_URL:-}` expands to on a Daytona install.
  const config = await loadConfig({
    SANDBOX_BROKER_URL: "",
    SANDBOX_BROKER_TOKEN: "",
    SANDBOX_BROKER_TOKEN_FILE: "",
    SANDBOX_BROKER_EXPECTED_VERSION: "",
  });
  assert.equal(config.SANDBOX_BROKER_URL, undefined);
  assert.equal(config.SANDBOX_BROKER_TOKEN, undefined);
  assert.equal(config.SANDBOX_BROKER_TOKEN_FILE, undefined);
  assert.equal(config.SANDBOX_BROKER_EXPECTED_VERSION, undefined);
});

void test("config: empty broker limits fall back to their defaults", async () => {
  const config = await loadConfig({
    SANDBOX_BROKER_CPU_CORES: "",
    SANDBOX_BROKER_MEMORY_MIB: "",
    SANDBOX_BROKER_PIDS: "",
    SANDBOX_BROKER_WORKSPACE_MIB: "",
  });
  assert.equal(config.SANDBOX_BROKER_CPU_CORES, 2);
  assert.equal(config.SANDBOX_BROKER_MEMORY_MIB, 2048);
  assert.equal(config.SANDBOX_BROKER_PIDS, 512);
  assert.equal(config.SANDBOX_BROKER_WORKSPACE_MIB, 4096);
});

void test("config: broker variables that are set are honored", async () => {
  const config = await loadConfig({
    SANDBOX_BROKER_URL: "http://sandbox-broker:8080",
    SANDBOX_BROKER_TOKEN_FILE: "/run/sandbox-broker/token",
    SANDBOX_BROKER_CPU_CORES: "4",
  });
  assert.equal(config.SANDBOX_BROKER_URL, "http://sandbox-broker:8080");
  assert.equal(config.SANDBOX_BROKER_TOKEN_FILE, "/run/sandbox-broker/token");
  assert.equal(config.SANDBOX_BROKER_CPU_CORES, 4);
});

void test("config: a malformed broker URL is still rejected", async () => {
  await assert.rejects(
    loadConfig({ SANDBOX_BROKER_URL: "not-a-url" }),
    /SANDBOX_BROKER_URL/,
  );
});
