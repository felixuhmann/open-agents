import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxSummaryDto } from "@open-agents/types";
import { AgentBackendError } from "../agent-backend/types.js";
import { createSandboxProviderRegistry } from "../sandbox-provider/registry.js";
import type {
  SandboxProvider,
  SandboxProviderId,
  SandboxSnapshot,
} from "../sandbox-provider/types.js";
import { createSandboxLifecycle } from "./sandboxLifecycle.js";
import type {
  SandboxLifecycleRepository,
  SandboxLifecycleRow,
} from "./sandboxLifecycle.js";

/**
 * Lifecycle dispatch must route each sandbox row through *its own* recorded
 * provider, never the deployment's currently active one, and must degrade one
 * row (or one provider) at a time.
 *
 * Repository and registry are injected, so none of this touches a database.
 */

const NOW = new Date("2026-07-22T12:00:00.000Z");
const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");

function row(overrides: Partial<SandboxLifecycleRow> = {}): SandboxLifecycleRow {
  return {
    id: "row_1",
    provider: "daytona",
    providerSandboxId: "sbx-1",
    sessionId: "daytona:agent_1:sbx-1",
    conversationId: "conv_1",
    threadId: null,
    createdAt: NOW,
    lastActivityAt: NOW,
    ...overrides,
  };
}

function snapshot(
  provider: SandboxProviderId,
  providerSandboxId: string,
  state: string,
): SandboxSnapshot {
  return {
    provider,
    providerSandboxId,
    state,
    lastActivityAt: null,
    errorReason: null,
    recoverable: null,
  };
}

type FakeProviderOptions = {
  id: SandboxProviderId;
  archive?: boolean;
  recover?: boolean;
  states?: Map<string, string>;
  missing?: Set<string>;
  owned?: { providerSandboxId: string; agentId?: string }[];
};

function fakeProvider(options: FakeProviderOptions) {
  const calls: string[] = [];
  const states = options.states ?? new Map<string, string>([["sbx-1", "started"]]);

  const read = (id: string): SandboxSnapshot => {
    if (options.missing?.has(id)) {
      throw new AgentBackendError(`Sandbox not found: ${id} (HTTP 404)`);
    }
    return snapshot(options.id, id, states.get(id) ?? "started");
  };

  const provider: SandboxProvider = {
    id: options.id,
    capabilities: {
      networkModes: ["deny-all"],
      archive: options.archive ?? false,
      recover: options.recover ?? false,
    },
    health: () => Promise.resolve({ available: true }),
    validatePolicy: () => undefined,
    create: () => Promise.reject(new Error("not used")),
    connect: () => Promise.reject(new Error("not used")),
    inspect: (id) => {
      calls.push(`inspect:${id}`);
      return Promise.resolve(read(id));
    },
    start: (id) => {
      calls.push(`start:${id}`);
      states.set(id, "started");
      return Promise.resolve(read(id));
    },
    stop: (id) => {
      calls.push(`stop:${id}`);
      states.set(id, "stopped");
      return Promise.resolve(read(id));
    },
    delete: (id) => {
      calls.push(`delete:${id}`);
      states.set(id, "deleted");
      return Promise.resolve();
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    listOwned: async function* () {
      for (const item of options.owned ?? []) {
        yield {
          ...snapshot(options.id, item.providerSandboxId, "started"),
          ...(item.agentId ? { agentId: item.agentId } : {}),
        };
      }
    },
  };

  if (options.archive) {
    provider.archive = (id) => {
      calls.push(`archive:${id}`);
      states.set(id, "archived");
      return Promise.resolve(read(id));
    };
  }
  if (options.recover) {
    provider.recover = (id) => {
      calls.push(`recover:${id}`);
      states.set(id, "stopped");
      return Promise.resolve(read(id));
    };
  }

  return { provider, calls, states };
}

function fakeRepository(rows: SandboxLifecycleRow[]) {
  const applied: { rowId: string; state: string }[] = [];
  const deleted: string[] = [];
  const cleared: string[] = [];
  const known = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = known.get(r.provider) ?? new Set<string>();
    set.add(r.providerSandboxId);
    known.set(r.provider, set);
  }

  const repository: SandboxLifecycleRepository = {
    getRow: (id) => Promise.resolve(rows.find((r) => r.id === id) ?? null),
    listActive: () => Promise.resolve([...rows]),
    listKnownProviderSandboxIds: (provider) =>
      Promise.resolve(known.get(provider) ?? new Set<string>()),
    applySnapshot: (rowId, snap) => {
      applied.push({ rowId, state: snap.state });
      return Promise.resolve({ id: rowId, state: snap.state } as SandboxSummaryDto);
    },
    markDeleted: (rowId) => {
      deleted.push(rowId);
      return Promise.resolve();
    },
    clearSessionPointers: (r) => {
      cleared.push(r.id);
      return Promise.resolve();
    },
  };

  return { repository, applied, deleted, cleared };
}

function lifecycleFor(
  rows: SandboxLifecycleRow[],
  providers: Partial<Record<SandboxProviderId, SandboxProvider | null>>,
) {
  const repo = fakeRepository(rows);
  const registry = createSandboxProviderRegistry(
    Object.fromEntries(
      Object.entries(providers).map(([id, provider]) => [
        id,
        () => Promise.resolve(provider ?? null),
      ]),
    ),
  );
  return {
    ...repo,
    lifecycle: createSandboxLifecycle({
      registry,
      repository: repo.repository,
      now: () => NOW,
    }),
  };
}

// ---------------------------------------------------------------- dispatch

void test("sync, stop, start, and delete dispatch through the row's own provider", async () => {
  const daytona = fakeProvider({ id: "daytona" });
  const broker = fakeProvider({ id: "broker" });
  const rows = [
    row({ id: "row_d", provider: "daytona", providerSandboxId: "sbx-1" }),
    row({
      id: "row_b",
      provider: "broker",
      providerSandboxId: "sbx-1",
      sessionId: "broker:agent_1:sbx-1",
    }),
  ];
  const { lifecycle } = lifecycleFor(rows, {
    daytona: daytona.provider,
    broker: broker.provider,
  });

  await lifecycle.syncFromProvider("row_b");
  await lifecycle.stop("row_b");
  await lifecycle.start("row_b");
  await lifecycle.remove("row_b");

  assert.deepEqual(broker.calls, [
    "inspect:sbx-1",
    "stop:sbx-1",
    "start:sbx-1",
    "delete:sbx-1",
  ]);
  assert.deepEqual(daytona.calls, []);
});

void test("deleting clears the owning session pointer and marks the row deleted", async () => {
  const daytona = fakeProvider({ id: "daytona" });
  const fixture = lifecycleFor([row()], { daytona: daytona.provider });

  await fixture.lifecycle.remove("row_1");

  assert.deepEqual(fixture.cleared, ["row_1"]);
  assert.deepEqual(fixture.deleted, ["row_1"]);
});

void test("archive and recover fail with an actionable message when the provider lacks them", async () => {
  const broker = fakeProvider({ id: "broker", archive: false, recover: false });
  const { lifecycle } = lifecycleFor(
    [row({ provider: "broker", sessionId: "broker:agent_1:sbx-1" })],
    { broker: broker.provider },
  );

  for (const action of ["archive", "recover"] as const) {
    await assert.rejects(
      () => lifecycle[action]("row_1"),
      (err: unknown) =>
        err instanceof AgentBackendError &&
        err.message.includes("broker") &&
        err.message.includes(action),
      `${action} should report an unsupported capability`,
    );
  }
  assert.deepEqual(broker.calls, []);
});

void test("archive and recover still work on a provider that supports them", async () => {
  const daytona = fakeProvider({ id: "daytona", archive: true, recover: true });
  const { lifecycle } = lifecycleFor([row()], { daytona: daytona.provider });

  await lifecycle.archive("row_1");
  await lifecycle.recover("row_1");

  assert.deepEqual(daytona.calls, ["archive:sbx-1", "recover:sbx-1"]);
});

void test("a row naming an unknown provider fails locally with a clear message", async () => {
  const daytona = fakeProvider({ id: "daytona" });
  const { lifecycle } = lifecycleFor([row({ id: "row_x", provider: "modal" })], {
    daytona: daytona.provider,
  });

  await assert.rejects(
    () => lifecycle.syncFromProvider("row_x"),
    (err: unknown) => err instanceof AgentBackendError && err.message.includes("modal"),
  );
});

void test("acting on a missing row reports the row id", async () => {
  const { lifecycle } = lifecycleFor([], {
    daytona: fakeProvider({ id: "daytona" }).provider,
  });

  await assert.rejects(
    () => lifecycle.syncFromProvider("nope"),
    (err: unknown) => err instanceof AgentBackendError && err.message.includes("nope"),
  );
});

// ------------------------------------------------------------- reconcile

void test("reconcile syncs every provider's rows", async () => {
  const daytona = fakeProvider({ id: "daytona" });
  const broker = fakeProvider({ id: "broker" });
  const fixture = lifecycleFor(
    [
      row({ id: "row_d", provider: "daytona" }),
      row({ id: "row_b", provider: "broker", sessionId: "broker:agent_1:sbx-1" }),
    ],
    { daytona: daytona.provider, broker: broker.provider },
  );

  const result = await fixture.lifecycle.reconcile();

  assert.equal(result.synced, 2);
  assert.equal(result.errors, 0);
  assert.deepEqual(fixture.applied.map((a) => a.rowId).sort(), ["row_b", "row_d"]);
});

void test("one unavailable provider does not block reconciling the other", async () => {
  const daytona = fakeProvider({ id: "daytona" });
  const fixture = lifecycleFor(
    [
      row({ id: "row_d", provider: "daytona" }),
      row({ id: "row_b", provider: "broker", sessionId: "broker:agent_1:sbx-1" }),
    ],
    { daytona: daytona.provider, broker: null },
  );

  const result = await fixture.lifecycle.reconcile();

  assert.equal(result.synced, 1);
  assert.equal(result.errors, 1);
  assert.deepEqual(
    fixture.applied.map((a) => a.rowId),
    ["row_d"],
  );
});

void test("a single failing row does not abort the reconcile job", async () => {
  const daytona = fakeProvider({ id: "daytona" });
  daytona.provider.inspect = (id) =>
    id === "boom"
      ? Promise.reject(new Error("provider exploded"))
      : Promise.resolve(snapshot("daytona", id, "started"));
  const fixture = lifecycleFor(
    [
      row({ id: "row_ok", providerSandboxId: "sbx-1" }),
      row({ id: "row_bad", providerSandboxId: "boom" }),
    ],
    { daytona: daytona.provider },
  );

  const result = await fixture.lifecycle.reconcile();

  assert.equal(result.synced, 1);
  assert.equal(result.errors, 1);
});

void test("a sandbox the provider no longer has clears its session pointer", async () => {
  const daytona = fakeProvider({ id: "daytona", missing: new Set(["sbx-gone"]) });
  const fixture = lifecycleFor([row({ id: "row_gone", providerSandboxId: "sbx-gone" })], {
    daytona: daytona.provider,
  });

  const result = await fixture.lifecycle.reconcile();

  assert.equal(result.pointersCleared, 1);
  assert.deepEqual(fixture.cleared, ["row_gone"]);
  assert.deepEqual(fixture.deleted, ["row_gone"]);
});

void test("reconcile stops long-idle and orphaned sandboxes", async () => {
  const daytona = fakeProvider({
    id: "daytona",
    states: new Map([
      ["sbx-stale", "started"],
      ["sbx-orphan", "started"],
      ["sbx-live", "started"],
    ]),
  });
  const fixture = lifecycleFor(
    [
      row({ id: "row_stale", providerSandboxId: "sbx-stale", lastActivityAt: LONG_AGO }),
      row({
        id: "row_orphan",
        providerSandboxId: "sbx-orphan",
        conversationId: null,
        threadId: null,
        createdAt: LONG_AGO,
      }),
      row({ id: "row_live", providerSandboxId: "sbx-live" }),
    ],
    { daytona: daytona.provider },
  );

  const result = await fixture.lifecycle.reconcile();

  assert.equal(result.staleStopped, 1);
  assert.equal(result.orphansStopped, 1);
  assert.ok(daytona.calls.includes("stop:sbx-stale"));
  assert.ok(daytona.calls.includes("stop:sbx-orphan"));
  assert.equal(daytona.calls.includes("stop:sbx-live"), false);
});

// ----------------------------------------------------------------- orphans

void test("orphan listing spans providers and reports which one owns each sandbox", async () => {
  const daytona = fakeProvider({
    id: "daytona",
    owned: [
      { providerSandboxId: "sbx-1", agentId: "agent_1" },
      { providerSandboxId: "sbx-unknown", agentId: "agent_2" },
    ],
  });
  const broker = fakeProvider({
    id: "broker",
    owned: [{ providerSandboxId: "sbx-b", agentId: "agent_3" }],
  });
  const { lifecycle } = lifecycleFor(
    [row({ provider: "daytona", providerSandboxId: "sbx-1" })],
    { daytona: daytona.provider, broker: broker.provider },
  );

  const orphans = await lifecycle.listOrphans();

  assert.deepEqual(orphans, [
    {
      provider: "daytona",
      providerSandboxId: "sbx-unknown",
      state: "started",
      agentId: "agent_2",
    },
    {
      provider: "broker",
      providerSandboxId: "sbx-b",
      state: "started",
      agentId: "agent_3",
    },
  ]);
});

void test("orphan listing skips providers that are unavailable", async () => {
  const daytona = fakeProvider({
    id: "daytona",
    owned: [{ providerSandboxId: "sbx-unknown" }],
  });
  const { lifecycle } = lifecycleFor([], {
    daytona: daytona.provider,
    broker: null,
  });

  const orphans = await lifecycle.listOrphans();

  assert.deepEqual(
    orphans.map((o) => o.provider),
    ["daytona"],
  );
});
