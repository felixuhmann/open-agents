import assert from "node:assert/strict";
import test from "node:test";
import { AgentBackendError } from "../agent-backend/types.js";
import { resolveProviderForNewSandbox } from "./activeProvider.js";
import { createSandboxProviderRegistry } from "./registry.js";
import type { SandboxProvider, SandboxProviderId } from "./types.js";

/**
 * Only sandbox *creation* is allowed to depend on the deployment-wide
 * selection. An unavailable active provider must produce an actionable,
 * operator-facing failure — never a bare 500 — and must never take existing
 * sessions on other providers down with it.
 */

function fakeProvider(id: SandboxProviderId): SandboxProvider {
  return {
    id,
    capabilities: { networkModes: ["deny-all"], archive: false, recover: false },
    health: () => Promise.resolve({ available: true }),
    validatePolicy: () => undefined,
    create: () => Promise.reject(new Error("not used")),
    connect: () => Promise.reject(new Error("not used")),
    inspect: () => Promise.reject(new Error("not used")),
    start: () => Promise.reject(new Error("not used")),
    stop: () => Promise.reject(new Error("not used")),
    delete: () => Promise.reject(new Error("not used")),
    // eslint-disable-next-line @typescript-eslint/require-await, require-yield
    listOwned: async function* () {
      throw new Error("not used");
    },
  };
}

void test("the active provider is returned when it is configured", async () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.resolve(fakeProvider("daytona")),
    broker: () => Promise.resolve(fakeProvider("broker")),
  });

  const provider = await resolveProviderForNewSandbox(registry, "broker");

  assert.equal(provider.id, "broker");
});

void test("an unconfigured active provider fails with an actionable 503", async () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.resolve(fakeProvider("daytona")),
    broker: () => Promise.resolve(null),
  });

  await assert.rejects(
    () => resolveProviderForNewSandbox(registry, "broker"),
    (err: unknown) => {
      assert.ok(err instanceof AgentBackendError);
      assert.equal(err.status, 503);
      assert.match(err.message, /broker/);
      assert.match(err.message, /not configured/);
      return true;
    },
  );
});

void test("a broken provider reports why, not just 'not configured'", async () => {
  const registry = createSandboxProviderRegistry({
    broker: () => Promise.reject(new Error("broker token file is empty")),
  });

  await assert.rejects(
    () => resolveProviderForNewSandbox(registry, "broker"),
    (err: unknown) => {
      assert.ok(err instanceof AgentBackendError);
      assert.equal(err.status, 503);
      assert.match(err.message, /broker token file is empty/);
      return true;
    },
  );
});

void test("an unavailable active provider leaves other providers resolvable", async () => {
  const registry = createSandboxProviderRegistry({
    daytona: () => Promise.resolve(fakeProvider("daytona")),
    broker: () => Promise.resolve(null),
  });

  await assert.rejects(() => resolveProviderForNewSandbox(registry, "broker"));

  // An existing Daytona session still resolves its own provider, which is
  // what keeps historical sessions streaming after a bad switch.
  assert.equal((await registry.get("daytona")).id, "daytona");
});
