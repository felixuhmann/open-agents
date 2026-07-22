import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxProviderRegistry } from "../sandbox-provider/registry.js";
import type {
  ProviderHealth,
  SandboxProvider,
  SandboxProviderId,
} from "../sandbox-provider/types.js";
import {
  createSandboxProviderSettings,
  isSessionProviderMismatch,
  parseActiveSandboxProviderId,
} from "./sandboxProviderSettings.js";

/**
 * One provider is active deployment-wide. A deployment that predates the
 * setting must keep behaving exactly as before (Daytona), and a failed
 * selection must leave the stored value untouched.
 */

function fakeProvider(
  id: SandboxProviderId,
  health: ProviderHealth = { available: true },
): SandboxProvider {
  return {
    id,
    capabilities: {
      networkModes: id === "daytona" ? ["deny-all", "cidr-allowlist"] : ["deny-all"],
      archive: id === "daytona",
      recover: id === "daytona",
    },
    health: () => Promise.resolve(health),
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

function fixture(options: {
  stored?: string | null;
  /**
   * `null` means registered-but-unconfigured; an `Error` means registered and
   * misconfigured, which admins must be able to tell apart.
   */
  providers: Partial<Record<SandboxProviderId, SandboxProvider | Error | null>>;
}) {
  let stored = options.stored ?? null;
  const writes: string[] = [];
  let resets = 0;

  const registry = createSandboxProviderRegistry(
    Object.fromEntries(
      Object.entries(options.providers).map(([id, provider]) => [
        id,
        () =>
          provider instanceof Error
            ? Promise.reject(provider)
            : Promise.resolve(provider ?? null),
      ]),
    ),
  );

  const settings = createSandboxProviderSettings({
    registry,
    readSetting: () => Promise.resolve(stored),
    writeSetting: (value) => {
      writes.push(value);
      stored = value;
      return Promise.resolve();
    },
    onChange: () => {
      resets += 1;
    },
  });

  return {
    settings,
    writes,
    stored: () => stored,
    resets: () => resets,
  };
}

// ------------------------------------------------------------- parsing

void test("a missing provider setting means Daytona", () => {
  assert.equal(parseActiveSandboxProviderId(null), "daytona");
  assert.equal(parseActiveSandboxProviderId(undefined), "daytona");
  assert.equal(parseActiveSandboxProviderId(""), "daytona");
});

void test("an unrecognized stored value falls back to Daytona rather than breaking the deployment", () => {
  assert.equal(parseActiveSandboxProviderId("modal"), "daytona");
  assert.equal(parseActiveSandboxProviderId("DAYTONA"), "daytona");
});

void test("a recognized stored value is honored", () => {
  assert.equal(parseActiveSandboxProviderId("daytona"), "daytona");
  assert.equal(parseActiveSandboxProviderId("broker"), "broker");
});

// -------------------------------------------------------- active provider

void test("deployments with no setting resolve to Daytona", async () => {
  const { settings } = fixture({ providers: { daytona: fakeProvider("daytona") } });
  assert.equal(await settings.getActiveProviderId(), "daytona");
});

void test("a stored selection is used for new sandboxes", async () => {
  const { settings } = fixture({
    stored: "broker",
    providers: { daytona: fakeProvider("daytona"), broker: fakeProvider("broker") },
  });
  assert.equal(await settings.getActiveProviderId(), "broker");
});

// -------------------------------------------------------------- describe

void test("status reports availability and capabilities per provider", async () => {
  const { settings } = fixture({
    providers: {
      daytona: fakeProvider("daytona"),
      broker: null,
    },
  });

  const status = await settings.describe();

  assert.equal(status.active, "daytona");
  const daytona = status.providers.find((p) => p.id === "daytona");
  assert.equal(daytona?.available, true);
  assert.equal(daytona?.capabilities?.archive, true);
  assert.deepEqual(daytona?.capabilities?.networkModes, ["deny-all", "cidr-allowlist"]);

  const broker = status.providers.find((p) => p.id === "broker");
  assert.equal(broker?.available, false);
  assert.equal(broker?.capabilities, null);
  assert.ok(broker?.detail);
});

void test("status reports a provider that is configured but failing its health check", async () => {
  const { settings } = fixture({
    providers: {
      daytona: fakeProvider("daytona", { available: false, detail: "401 unauthorized" }),
    },
  });

  const status = await settings.describe();
  const daytona = status.providers.find((p) => p.id === "daytona");

  assert.equal(daytona?.available, false);
  assert.equal(daytona?.detail, "401 unauthorized");
});

void test("status warns when the active provider is unusable", async () => {
  const { settings } = fixture({
    stored: "broker",
    providers: { daytona: fakeProvider("daytona"), broker: null },
  });

  const status = await settings.describe();

  assert.equal(status.active, "broker");
  assert.equal(
    status.warnings.some((w) => w.includes("broker")),
    true,
  );
});

// ---------------------------------------------------------------- select

void test("preflight verifies availability without mutating deployment state", async () => {
  const f = fixture({
    stored: "daytona",
    providers: { daytona: fakeProvider("daytona"), broker: fakeProvider("broker") },
  });

  await f.settings.preflight("broker");

  assert.deepEqual(f.writes, []);
  assert.equal(f.stored(), "daytona");
  assert.equal(f.resets(), 0);
});

void test("preflight fails closed without mutating deployment state", async () => {
  const f = fixture({
    stored: "daytona",
    providers: { daytona: fakeProvider("daytona"), broker: null },
  });

  await assert.rejects(
    () => f.settings.preflight("broker"),
    (err: unknown) => err instanceof Error && err.message.includes("broker"),
  );

  assert.deepEqual(f.writes, []);
  assert.equal(f.stored(), "daytona");
  assert.equal(f.resets(), 0);
});

void test("selecting an available provider persists it and resets cached providers", async () => {
  const f = fixture({
    providers: { daytona: fakeProvider("daytona"), broker: fakeProvider("broker") },
  });

  const status = await f.settings.select("broker");

  assert.equal(status.active, "broker");
  assert.deepEqual(f.writes, ["broker"]);
  assert.equal(f.resets(), 1);
});

void test("selecting an unavailable provider fails and does not mutate the setting", async () => {
  const f = fixture({
    stored: "daytona",
    providers: { daytona: fakeProvider("daytona"), broker: null },
  });

  await assert.rejects(
    () => f.settings.select("broker"),
    (err: unknown) => err instanceof Error && err.message.includes("broker"),
  );

  assert.deepEqual(f.writes, []);
  assert.equal(f.stored(), "daytona");
  assert.equal(f.resets(), 0);
  assert.equal(await f.settings.getActiveProviderId(), "daytona");
});

void test("selecting a provider that is configured but unhealthy also fails closed", async () => {
  const f = fixture({
    stored: "daytona",
    providers: {
      daytona: fakeProvider("daytona"),
      broker: fakeProvider("broker", { available: false, detail: "connection refused" }),
    },
  });

  await assert.rejects(
    () => f.settings.select("broker"),
    (err: unknown) => err instanceof Error && err.message.includes("connection refused"),
  );
  assert.deepEqual(f.writes, []);
  assert.equal(f.stored(), "daytona");
});

void test("re-selecting the current provider is a no-op that still succeeds", async () => {
  const f = fixture({
    stored: "daytona",
    providers: { daytona: fakeProvider("daytona") },
  });

  const status = await f.settings.select("daytona");

  assert.equal(status.active, "daytona");
});

void test("a misconfigured provider explains itself instead of reporting 'not configured'", async () => {
  const f = fixture({
    stored: "daytona",
    providers: {
      daytona: fakeProvider("daytona"),
      broker: new Error("SANDBOX_BROKER_TOKEN_FILE at /run/broker/token is empty."),
    },
  });

  const status = await f.settings.describe();
  const broker = status.providers.find((p) => p.id === "broker");

  assert.equal(broker?.available, false);
  assert.match(broker?.detail ?? "", /token is empty/);
});

void test("selecting a misconfigured provider fails with its actual reason", async () => {
  const f = fixture({
    stored: "daytona",
    providers: {
      daytona: fakeProvider("daytona"),
      broker: new Error("SANDBOX_BROKER_URL is set but no broker credential is."),
    },
  });

  await assert.rejects(
    () => f.settings.select("broker"),
    (err: unknown) =>
      err instanceof Error && err.message.includes("no broker credential"),
  );
  assert.deepEqual(f.writes, []);
});

// ------------------------------------------------------- session mismatch

void test("a session on the active provider is resumed", () => {
  assert.equal(isSessionProviderMismatch("daytona:agent_1:sbx-1", "daytona"), false);
  assert.equal(isSessionProviderMismatch("broker:agent_1:sbx-1", "broker"), false);
});

void test("a session on a different provider is not resumed", () => {
  assert.equal(isSessionProviderMismatch("daytona:agent_1:sbx-1", "broker"), true);
  assert.equal(isSessionProviderMismatch("broker:agent_1:sbx-1", "daytona"), true);
});

void test("an absent or unparseable session id is not treated as a mismatch", () => {
  assert.equal(isSessionProviderMismatch(null, "broker"), false);
  assert.equal(isSessionProviderMismatch("", "broker"), false);
  assert.equal(isSessionProviderMismatch("garbage", "broker"), false);
});
