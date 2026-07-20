import assert from "node:assert/strict";
import test from "node:test";
import { resolveOpenSandboxRuntimeConfig } from "./runtimeConfig.js";

const BASE = {
  OPENSANDBOX_IMAGE: "oa-guest:1.0.0",
};

void test("configuration requires OPENSANDBOX_BASE_URL", () => {
  assert.throws(
    () => resolveOpenSandboxRuntimeConfig({ ...BASE }),
    /OPENSANDBOX_BASE_URL/,
  );
});

void test("resolves endpoint, api key, and image from env", () => {
  const cfg = resolveOpenSandboxRuntimeConfig({
    ...BASE,
    OPENSANDBOX_BASE_URL: "http://opensandbox:8080",
    OPENSANDBOX_API_KEY: "k",
  });
  assert.equal(cfg.baseUrl, "http://opensandbox:8080");
  assert.equal(cfg.apiKey, "k");
  assert.equal(cfg.image, "oa-guest:1.0.0");
  assert.equal(cfg.resourceLimits, undefined);
});

void test("includes resource limits only when provided", () => {
  const cfg = resolveOpenSandboxRuntimeConfig({
    ...BASE,
    OPENSANDBOX_BASE_URL: "host:8080",
    OPENSANDBOX_CPU_LIMIT: "2",
    OPENSANDBOX_MEMORY_LIMIT: "4Gi",
  });
  assert.deepEqual(cfg.resourceLimits, { cpu: "2", memory: "4Gi" });
});
