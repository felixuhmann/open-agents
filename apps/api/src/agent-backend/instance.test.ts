import assert from "node:assert/strict";
import test from "node:test";
import { createAgentBackendResolver } from "./backendResolver.js";

/**
 * Characterization of the lazy backend singleton in `instance.ts`. The
 * credential lives in the encrypted Secret store, so the backend can only be
 * built after setup ran, is cached per credential value, and is rebuilt after
 * rotation or an explicit reset.
 *
 * The resolver is the injectable core; `instance.ts` supplies the real
 * credential reader and constructor.
 */

type FakeBackend = { id: number; key: string };

function fixture(initialKey: string | null) {
  let key = initialKey;
  let builds = 0;
  const resolver = createAgentBackendResolver<FakeBackend>({
    loadCredentialKey: () => Promise.resolve(key),
    build: (credentialKey) => ({ id: ++builds, key: credentialKey }),
    missingCredentialMessage:
      "Daytona API key is not configured. Complete setup at /setup.",
  });
  return {
    resolver,
    setKey: (next: string | null) => {
      key = next;
    },
    builds: () => builds,
  };
}

void test("resolving without a stored credential throws the setup guidance error", async () => {
  const { resolver } = fixture(null);

  await assert.rejects(
    () => resolver.get(),
    (err: unknown) =>
      err instanceof Error &&
      err.message === "Daytona API key is not configured. Complete setup at /setup.",
  );
});

void test("the same credential reuses one backend instance", async () => {
  const { resolver, builds } = fixture("key-a");

  const first = await resolver.get();
  const second = await resolver.get();

  assert.equal(first, second);
  assert.equal(builds(), 1);
});

void test("rotating the credential rebuilds the backend", async () => {
  const { resolver, setKey, builds } = fixture("key-a");

  const first = await resolver.get();
  setKey("key-b");
  const second = await resolver.get();

  assert.notEqual(first, second);
  assert.equal(second.key, "key-b");
  assert.equal(builds(), 2);
});

void test("reset forces the next resolution to rebuild", async () => {
  const { resolver, builds } = fixture("key-a");

  const first = await resolver.get();
  resolver.reset();
  const second = await resolver.get();

  assert.notEqual(first, second);
  assert.equal(builds(), 2);
});

void test("a credential removed after setup stops resolving instead of serving a stale backend", async () => {
  const { resolver, setKey } = fixture("key-a");

  await resolver.get();
  setKey(null);

  await assert.rejects(() => resolver.get());
});
