import assert from "node:assert/strict";
import test from "node:test";
import { AgentBackendError } from "../agent-backend/types.js";
import { createSandboxProviderRegistry } from "./registry.js";
import type { SandboxProvider, SandboxProviderId } from "./types.js";

function fakeProvider(id: SandboxProviderId): SandboxProvider {
  return {
    id,
    capabilities: {
      networkModes: id === "daytona" ? ["deny-all", "cidr-allowlist"] : ["deny-all"],
      archive: id === "daytona",
      recover: id === "daytona",
    },
    health: () => Promise.resolve({ available: true }),
    validatePolicy: () => undefined,
    create: () => {
      throw new Error("not used");
    },
    connect: () => {
      throw new Error("not used");
    },
    inspect: () => {
      throw new Error("not used");
    },
    start: () => {
      throw new Error("not used");
    },
    stop: () => {
      throw new Error("not used");
    },
    delete: () => {
      throw new Error("not used");
    },
    listOwned: () => {
      throw new Error("not used");
    },
  };
}

void test("a configured provider is built once and cached", async () => {
  let builds = 0;
  const registry = createSandboxProviderRegistry({
    daytona: () => {
      builds += 1;
      return Promise.resolve(fakeProvider("daytona"));
    },
  });

  const first = await registry.get("daytona");
  const second = await registry.get("daytona");

  assert.equal(first, second);
  assert.equal(first.id, "daytona");
  assert.equal(builds, 1);
});

void test("reset forces the next lookup to rebuild", async () => {
  let builds = 0;
  const registry = createSandboxProviderRegistry({
    daytona: () => {
      builds += 1;
      return Promise.resolve(fakeProvider("daytona"));
    },
  });

  await registry.get("daytona");
  registry.reset();
  await registry.get("daytona");

  assert.equal(builds, 2);
});

void test("an unregistered provider id is rejected", async () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.resolve(fakeProvider("daytona")),
  });

  await assert.rejects(
    () => registry.get("broker"),
    (err: unknown) => err instanceof AgentBackendError && err.message.includes("broker"),
  );
  assert.equal(await registry.tryGet("broker"), null);
});

void test("a provider whose factory reports it unconfigured resolves to null, not a throw, via tryGet", async () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.resolve(fakeProvider("daytona")),
    broker: () => Promise.resolve(null),
  });

  assert.equal(await registry.tryGet("broker"), null);
  await assert.rejects(() => registry.get("broker"));
  assert.equal((await registry.tryGet("daytona"))?.id, "daytona");
});

void test("an unconfigured provider is not cached, so configuring it later works", async () => {
  let configured = false;
  const registry = createSandboxProviderRegistry({
    broker: () => Promise.resolve(configured ? fakeProvider("broker") : null),
  });

  assert.equal(await registry.tryGet("broker"), null);
  configured = true;
  assert.equal((await registry.tryGet("broker"))?.id, "broker");
});

void test("listConfigured skips providers that are unconfigured or failing to build", async () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.resolve(fakeProvider("daytona")),
    broker: () => Promise.reject(new Error("broker unreachable")),
  });

  const configured = await registry.listConfigured();

  assert.deepEqual(
    configured.map((provider) => provider.id),
    ["daytona"],
  );
});

void test("registered ids are reported regardless of configuration state", () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.resolve(fakeProvider("daytona")),
    broker: () => Promise.resolve(null),
  });

  assert.deepEqual(registry.registeredIds(), ["daytona", "broker"]);
});

void test("a factory failure surfaces to callers that asked for that provider explicitly", async () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.reject(new Error("Daytona API key is not configured")),
  });

  await assert.rejects(
    () => registry.get("daytona"),
    (err: unknown) => err instanceof Error && err.message.includes("not configured"),
  );
  assert.equal(await registry.tryGet("daytona"), null);
});
