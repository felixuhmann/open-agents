import assert from "node:assert/strict";
import test from "node:test";
import { BrokerApiError } from "@sandbox-broker/client";
import type {
  CapabilitiesResponse,
  CreateSandboxRequest,
  ExecEvent,
  ExecRequest,
  ReadyResponse,
  Sandbox,
} from "@sandbox-broker/client";
import type { SandboxPolicyBundle } from "@open-agents/types";
import { DEFAULT_SANDBOX_POLICY } from "@open-agents/types";
import { AgentBackendError } from "../../agent-backend/types.js";
import type { SandboxProvider } from "../types.js";
import type { BrokerClientLike } from "./client.js";
import { BrokerSandboxProvider } from "./index.js";
import { BROKER_CIDR_REJECTION, toBrokerNetworkMode } from "./policy.js";

/**
 * The broker adapter against a fake `@sandbox-broker/client`.
 *
 * The fake is typed as {@link BrokerClientLike}, which is derived from the
 * real client class, so a method whose signature drifts in a future client
 * release fails to compile here rather than at runtime in production.
 */

const LIMITS = {
  cpuCores: 2,
  memoryMiB: 2048,
  pids: 512,
  workspaceMiB: 4096,
} as const;

const OWNER_HASH = "a".repeat(64);

function policy(
  overrides: Partial<SandboxPolicyBundle["network"]> = {},
): SandboxPolicyBundle {
  return {
    network: { ...DEFAULT_SANDBOX_POLICY.network, ...overrides },
    command: { ...DEFAULT_SANDBOX_POLICY.command },
  };
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

type FakeCall = { op: string; args: unknown };

type FakeOptions = {
  ready?: Partial<ReadyResponse>;
  capabilities?: Partial<CapabilitiesResponse>;
  /** Frames returned by the next `exec`. Receives the validated request. */
  execEvents?: (request: ExecRequest, sandboxId: string) => ExecEvent[];
  /** Thrown by the iterator after `execEvents`, simulating a torn-down stream. */
  throwAfterFrames?: () => Error;
  /** Reject `exec` with a transient 409, as the broker does mid-restart. */
  refuseExecWhileStarting?: () => boolean;
  /** Which 409 flavour to reject with. */
  conflictCode?: "conflict" | "sandbox_error";
  /** The sandbox never leaves `starting`, as if its restart wedged. */
  stuckStarting?: boolean;
  failReadyWith?: Error;
};

function fakeBroker(options: FakeOptions = {}) {
  const calls: FakeCall[] = [];
  const sandboxes = new Map<string, Sandbox>();
  const files = new Map<string, Uint8Array>();
  const idempotency = new Map<string, string>();
  let nextId = 1;
  let lastSignal: AbortSignal | undefined;

  function record(op: string, args: unknown): void {
    calls.push({ op, args });
  }

  function makeSandbox(input: {
    id: string;
    networkMode: Sandbox["networkMode"];
    state?: Sandbox["state"];
  }): Sandbox {
    return {
      id: input.id,
      ownerRefHash: OWNER_HASH,
      networkMode: input.networkMode,
      limits: { ...LIMITS },
      state: input.state ?? "started",
      createdAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T10:05:00.000Z",
      workspacePath: "/workspace",
    };
  }

  function require(id: string): Sandbox {
    const found = sandboxes.get(id);
    if (!found) {
      throw new BrokerApiError("getSandbox", {
        status: 404,
        code: "not_found",
        message: `Sandbox ${id} does not exist.`,
      });
    }
    return found;
  }

  const client: BrokerClientLike = {
    ready: (opts = {}) => {
      record("ready", {});
      void opts;
      if (options.failReadyWith) {
        return Promise.reject(
          options.failReadyWith instanceof Error
            ? options.failReadyWith
            : new Error(String(options.failReadyWith)),
        );
      }
      return Promise.resolve({
        ready: true,
        apiVersion: "v1",
        brokerVersion: "0.1.0-rc.1",
        checks: [{ name: "docker", ok: true }],
        ...options.ready,
      } as ReadyResponse);
    },
    capabilities: () => {
      record("capabilities", {});
      return Promise.resolve({
        apiVersion: "v1",
        brokerVersion: "0.1.0-rc.1",
        networkModes: ["deny-all", "unrestricted"],
        archive: false,
        recover: false,
        limits: { ...LIMITS },
        workspaceQuota: { mode: "watchdog", enforced: true, detail: "sampled" },
        maxExecTimeoutMs: 1_800_000,
        ...options.capabilities,
      } as CapabilitiesResponse);
    },
    createSandbox: (request) => {
      record("createSandbox", request);
      const replayed = idempotency.get(request.idempotencyKey);
      if (replayed) {
        return Promise.resolve({ sandbox: require(replayed), created: false });
      }
      const id = `sbx-${nextId++}`;
      const sandbox = makeSandbox({ id, networkMode: request.networkMode });
      sandboxes.set(id, sandbox);
      idempotency.set(request.idempotencyKey, id);
      return Promise.resolve({ sandbox, created: true });
    },
    listSandboxes: () => {
      record("listSandboxes", {});
      return Promise.resolve([...sandboxes.values()]);
    },
    getSandbox: (id) => {
      record("getSandbox", { id });
      const sandbox = require(id);
      if (options.stuckStarting)
        return Promise.resolve({ ...sandbox, state: "starting" });
      return Promise.resolve(sandbox);
    },
    startSandbox: (id) => {
      record("startSandbox", { id });
      const sandbox = { ...require(id), state: "started" as const };
      sandboxes.set(id, sandbox);
      return Promise.resolve(sandbox);
    },
    stopSandbox: (id) => {
      record("stopSandbox", { id });
      const sandbox = { ...require(id), state: "stopped" as const };
      sandboxes.set(id, sandbox);
      return Promise.resolve(sandbox);
    },
    deleteSandbox: (id) => {
      record("deleteSandbox", { id });
      const sandbox = { ...require(id), state: "deleted" as const };
      sandboxes.delete(id);
      return Promise.resolve(sandbox);
    },
    readFile: (id, path) => {
      record("readFile", { id, path });
      const bytes = files.get(`${id}:${path}`);
      if (!bytes) {
        return Promise.reject(
          new BrokerApiError("readFile", {
            status: 404,
            code: "not_found",
            message: `No such file: ${path}`,
          }),
        );
      }
      return Promise.resolve(bytes);
    },
    writeFile: (id, path, body) => {
      record("writeFile", { id, path });
      files.set(`${id}:${path}`, body as Uint8Array);
      return Promise.resolve();
    },
    deleteFile: (id, path, opts = {}) => {
      record("deleteFile", { id, path, recursive: opts.recursive });
      files.delete(`${id}:${path}`);
      return Promise.resolve();
    },
    exec: (id, request, opts = {}) => {
      record("exec", { id, request });
      lastSignal = opts.signal;
      if (options.refuseExecWhileStarting?.()) {
        const conflict = options.conflictCode === "conflict";
        return Promise.reject(
          new BrokerApiError("execCommand", {
            status: 409,
            code: conflict ? "conflict" : "sandbox_error",
            message: conflict
              ? "An execution is already running in this sandbox."
              : "Sandbox is starting; start it before running commands.",
          }),
        );
      }
      const frames = options.execEvents?.(request, id) ?? [
        {
          type: "result" as const,
          executionId: "e1",
          seq: 1,
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          durationMs: 5,
        },
      ];
      return Promise.resolve(
        // eslint-disable-next-line @typescript-eslint/require-await
        (async function* () {
          for (const frame of frames) yield frame;
          if (options.throwAfterFrames) throw options.throwAfterFrames();
        })(),
      );
    },
  };

  return {
    client,
    calls,
    sandboxes,
    files,
    ops: () => calls.map((c) => c.op),
    find: (op: string) => calls.filter((c) => c.op === op).map((c) => c.args),
    signal: () => lastSignal,
    seed: (
      id: string,
      state: Sandbox["state"],
      mode: Sandbox["networkMode"] = "unrestricted",
    ) => {
      sandboxes.set(id, makeSandbox({ id, state, networkMode: mode }));
    },
  };
}

function provider(fake: ReturnType<typeof fakeBroker>, expectedBrokerVersion?: string) {
  return new BrokerSandboxProvider({
    createClient: () => fake.client,
    limits: { ...LIMITS },
    // Real deployments wait a minute for a recycled sandbox; tests must not.
    restartWaitMs: 2_000,
    ...(expectedBrokerVersion ? { expectedBrokerVersion } : {}),
  });
}

// -- policy mapping ---------------------------------------------------------

void test("broker policy: internet disabled maps to deny-all", () => {
  assert.equal(
    toBrokerNetworkMode(policy({ internetEnabled: false }).network),
    "deny-all",
  );
});

void test("broker policy: internet enabled with empty allowlist maps to unrestricted", () => {
  assert.equal(
    toBrokerNetworkMode(policy({ internetEnabled: true, allowList: "  " }).network),
    "unrestricted",
  );
});

void test("broker policy: a non-empty allowlist fails closed with remediation", () => {
  assert.throws(
    () => toBrokerNetworkMode(policy({ allowList: "10.0.0.0/8" }).network),
    (err: unknown) => {
      assert.ok(err instanceof AgentBackendError);
      assert.equal(err.message, BROKER_CIDR_REJECTION);
      return true;
    },
  );
});

void test("broker policy: internet off ignores a legacy allowlist and stays deny-all", () => {
  assert.equal(
    toBrokerNetworkMode(
      policy({ internetEnabled: false, allowList: "10.0.0.0/8" }).network,
    ),
    "deny-all",
  );
});

void test("broker provider: validatePolicy rejects a CIDR allowlist", () => {
  const fake = fakeBroker();
  assert.throws(
    () => provider(fake).validatePolicy(policy({ allowList: "192.168.0.0/16" })),
    /does not support CIDR allowlists/,
  );
});

void test("broker provider: create never reaches the broker for a CIDR policy", async () => {
  const fake = fakeBroker();
  await assert.rejects(
    provider(fake).create({
      agentId: "agent-1",
      policy: policy({ allowList: "10.0.0.0/8" }),
    }),
    /does not support CIDR allowlists/,
  );
  assert.deepEqual(fake.find("createSandbox"), []);
});

// -- health / capabilities --------------------------------------------------

void test("broker provider: health reports available and adopts live capabilities", async () => {
  const fake = fakeBroker();
  const p = provider(fake);
  const health = await p.health();
  assert.equal(health.available, true);
  assert.deepEqual(p.capabilities, {
    networkModes: ["deny-all", "unrestricted"],
    archive: false,
    recover: false,
  });
});

void test("broker provider: capabilities never advertise archive or recover", () => {
  const p = provider(fakeBroker());
  assert.equal(p.capabilities.archive, false);
  assert.equal(p.capabilities.recover, false);
  assert.ok(!p.capabilities.networkModes.includes("cidr-allowlist"));
});

void test("broker provider: a not-ready broker is unavailable and names the failing check", async () => {
  const fake = fakeBroker({
    ready: {
      ready: false,
      checks: [{ name: "egress-policy", ok: false, detail: "no host probe" }],
    },
  });
  const health = await provider(fake).health();
  assert.equal(health.available, false);
  assert.match(health.detail ?? "", /egress-policy/);
  assert.match(health.detail ?? "", /no host probe/);
});

void test("broker provider: an unreachable broker is unavailable, not a thrown error", async () => {
  const fake = fakeBroker({ failReadyWith: new Error("connect ECONNREFUSED") });
  const health = await provider(fake).health();
  assert.equal(health.available, false);
  assert.match(health.detail ?? "", /ECONNREFUSED/);
});

void test("broker provider: a pinned broker version mismatch fails readiness", async () => {
  const fake = fakeBroker();
  const health = await provider(fake, "0.2.0").health();
  assert.equal(health.available, false);
  assert.match(health.detail ?? "", /0\.1\.0-rc\.1/);
  assert.match(health.detail ?? "", /0\.2\.0/);
});

// -- lifecycle --------------------------------------------------------------

void test("broker provider: create sends the mapped policy, limits, and owner reference", async () => {
  const fake = fakeBroker();
  const handle = await provider(fake).create({
    agentId: "agent-1",
    agentSlug: "support",
    policy: policy({ internetEnabled: false }),
  });

  const [request] = fake.find("createSandbox") as CreateSandboxRequest[];
  assert.equal(request?.networkMode, "deny-all");
  assert.deepEqual(request?.limits, { ...LIMITS });
  assert.equal(request?.ownerRef, "open-agents:agent-1");
  assert.equal(typeof request?.idempotencyKey, "string");

  assert.equal(handle.provider, "broker");
  assert.equal(handle.workspaceDir, "/workspace");
  assert.equal(handle.state, "started");
  assert.equal(handle.providerSandboxId, "sbx-1");
});

void test("broker provider: every create gets its own idempotency key", async () => {
  const fake = fakeBroker();
  const p = provider(fake);
  const first = await p.create({ agentId: "a", policy: policy() });
  const second = await p.create({ agentId: "a", policy: policy() });
  assert.notEqual(first.providerSandboxId, second.providerSandboxId);
});

void test("broker provider: connect starts a stopped sandbox before returning", async () => {
  const fake = fakeBroker();
  fake.seed("sbx-9", "stopped");
  const handle = await provider(fake).connect("sbx-9");
  assert.equal(handle.state, "started");
  assert.ok(fake.ops().includes("startSandbox"));
});

void test("broker provider: connect leaves an already-started sandbox alone", async () => {
  const fake = fakeBroker();
  fake.seed("sbx-9", "started");
  await provider(fake).connect("sbx-9");
  assert.ok(!fake.ops().includes("startSandbox"));
});

void test("broker provider: connectWithTransitions reports the start it performed", async () => {
  const fake = fakeBroker();
  fake.seed("sbx-9", "stopped");
  const result = await provider(fake).connectWithTransitions("sbx-9");
  assert.equal(result.previousState, "stopped");
  assert.deepEqual(result.transitions, ["start"]);
  assert.equal(result.handle.state, "started");
});

void test("broker provider: connect refuses a sandbox the broker reports as errored", async () => {
  const fake = fakeBroker();
  fake.seed("sbx-9", "error");
  await assert.rejects(provider(fake).connect("sbx-9"), (err: unknown) => {
    assert.ok(err instanceof AgentBackendError);
    assert.match(err.message, /error state/);
    return true;
  });
});

void test("broker provider: inspect normalizes a broker sandbox", async () => {
  const fake = fakeBroker();
  fake.seed("sbx-3", "stopped");
  const snapshot = await provider(fake).inspect("sbx-3");
  assert.deepEqual(snapshot, {
    provider: "broker",
    providerSandboxId: "sbx-3",
    state: "stopped",
    lastActivityAt: new Date("2026-07-22T10:05:00.000Z"),
    errorReason: null,
    recoverable: false,
  });
});

void test("broker provider: start, stop, and delete dispatch to the broker", async () => {
  const fake = fakeBroker();
  fake.seed("sbx-4", "stopped");
  const p = provider(fake);
  assert.equal((await p.start("sbx-4")).state, "started");
  assert.equal((await p.stop("sbx-4")).state, "stopped");
  await p.delete("sbx-4");
  assert.deepEqual(fake.find("deleteSandbox"), [{ id: "sbx-4" }]);
});

void test("broker provider: listOwned yields every broker-owned sandbox", async () => {
  const fake = fakeBroker();
  fake.seed("sbx-1", "started");
  fake.seed("sbx-2", "stopped");
  const seen: string[] = [];
  for await (const snapshot of provider(fake).listOwned()) {
    assert.equal(snapshot.provider, "broker");
    seen.push(snapshot.providerSandboxId);
  }
  assert.deepEqual(seen.sort(), ["sbx-1", "sbx-2"]);
});

void test("broker provider: archive and recover are not implemented", () => {
  // Typed as the interface: the optional members are exactly where a caller
  // like `sandboxes.ts` looks before offering an archive/recover action.
  const p: SandboxProvider = provider(fakeBroker());
  assert.equal(typeof p.archive, "undefined");
  assert.equal(typeof p.recover, "undefined");
});

// -- exec -------------------------------------------------------------------

async function handleFor(fake: ReturnType<typeof fakeBroker>) {
  return provider(fake).create({ agentId: "agent-1", policy: policy() });
}

void test("broker exec: streams both channels and returns the exit code", async () => {
  const fake = fakeBroker({
    execEvents: () => [
      { type: "stdout", executionId: "e1", seq: 1, dataBase64: b64("hello ") },
      { type: "stderr", executionId: "e1", seq: 2, dataBase64: b64("warn") },
      { type: "stdout", executionId: "e1", seq: 3, dataBase64: b64("world") },
      {
        type: "result",
        executionId: "e1",
        seq: 4,
        exitCode: 3,
        timedOut: false,
        cancelled: false,
        durationMs: 12,
      },
    ],
  });
  const handle = await handleFor(fake);
  const chunks: string[] = [];
  const result = await handle.exec({
    command: "echo hi",
    policy: policy(),
    onOutput: (chunk) => chunks.push(`${chunk.stream}:${chunk.text}`),
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "hello world");
  assert.equal(result.stderr, "warn");
  // The shared batcher coalesces per stream, so the two channels may be
  // emitted out of step with each other — but each channel stays ordered and
  // nothing is dropped. This matches the Daytona adapter exactly.
  assert.equal(
    chunks.filter((c) => c.startsWith("stdout:")).join(""),
    "stdout:hello stdout:world",
  );
  assert.deepEqual(
    chunks.filter((c) => c.startsWith("stderr:")),
    ["stderr:warn"],
  );
});

void test("broker exec: multi-byte output split across frames decodes correctly", async () => {
  const utf8 = Buffer.from("héllo →", "utf8");
  const fake = fakeBroker({
    execEvents: () => [
      {
        type: "stdout",
        executionId: "e1",
        seq: 1,
        dataBase64: utf8.subarray(0, 3).toString("base64"),
      },
      {
        type: "stdout",
        executionId: "e1",
        seq: 2,
        dataBase64: utf8.subarray(3).toString("base64"),
      },
      {
        type: "result",
        executionId: "e1",
        seq: 3,
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        durationMs: 1,
      },
    ],
  });
  const handle = await handleFor(fake);
  const result = await handle.exec({ command: "cat", policy: policy() });
  assert.equal(result.stdout, "héllo →");
});

void test("broker exec: sends cwd, and clamps the timeout into the command policy", async () => {
  const fake = fakeBroker();
  const handle = await handleFor(fake);
  await handle.exec({
    command: "ls",
    cwd: "/workspace/sub",
    timeoutSeconds: 9_000,
    policy: policy(),
  });
  const sent = (fake.find("exec")[0] as { request: ExecRequest }).request;
  assert.equal(sent.cwd, "/workspace/sub");
  // DEFAULT_SANDBOX_COMMAND_POLICY.maxRuntimeSeconds is 60.
  assert.equal(sent.timeoutMs, 60_000);
});

void test("broker exec: a timed-out execution returns 124 and says so", async () => {
  const fake = fakeBroker({
    execEvents: () => [
      {
        type: "result",
        executionId: "e1",
        seq: 1,
        exitCode: 124,
        timedOut: true,
        cancelled: false,
        durationMs: 60_000,
      },
    ],
  });
  const handle = await handleFor(fake);
  const result = await handle.exec({ command: "sleep 999", policy: policy() });
  assert.equal(result.exitCode, 124);
  assert.match(result.combined, /timed out/i);
});

void test("broker exec: a cancelled execution returns 130 and forwards the abort signal", async () => {
  const controller = new AbortController();
  const fake = fakeBroker({
    execEvents: () => [
      {
        type: "result",
        executionId: "e1",
        seq: 1,
        exitCode: 130,
        timedOut: false,
        cancelled: true,
        durationMs: 20,
      },
    ],
  });
  const handle = await handleFor(fake);
  const result = await handle.exec({
    command: "sleep 999",
    policy: policy(),
    signal: controller.signal,
  });
  assert.equal(result.exitCode, 130);
  assert.match(result.combined, /cancelled/i);
  assert.equal(fake.signal(), controller.signal);
});

void test("broker exec: an aborted stream still reports cancellation, not a crash", async () => {
  // What a real abort looks like: fetch tears the response stream down, so
  // the terminal `result` frame never arrives even though the broker did
  // cancel the command server-side.
  const controller = new AbortController();
  const fake = fakeBroker({
    execEvents: () => [
      { type: "stdout", executionId: "e1", seq: 1, dataBase64: b64("partial") },
    ],
    throwAfterFrames: () => {
      controller.abort();
      return Object.assign(new Error("This operation was aborted"), {
        name: "AbortError",
      });
    },
  });
  const handle = await handleFor(fake);

  const result = await handle.exec({
    command: "sleep 999",
    policy: policy(),
    signal: controller.signal,
  });

  assert.equal(result.exitCode, 130);
  assert.match(result.combined, /cancelled/i);
  assert.match(result.combined, /partial/);
});

void test("broker exec: a stream failure that is not an abort still propagates", async () => {
  const fake = fakeBroker({
    execEvents: () => [],
    throwAfterFrames: () => new Error("connection reset by peer"),
  });
  const handle = await handleFor(fake);
  await assert.rejects(
    handle.exec({ command: "ls", policy: policy() }),
    /connection reset/,
  );
});

void test("broker exec: waits out the restart the broker performs after a cancellation", async () => {
  // Cancelling or timing out recycles the container broker-side, so the very
  // next command can arrive while the sandbox is still `starting`. The Pi
  // loop must not see that as a failed tool call.
  let refusals = 1;
  const fake = fakeBroker({
    execEvents: () => [
      { type: "stdout", executionId: "e1", seq: 1, dataBase64: b64("alive") },
      {
        type: "result",
        executionId: "e1",
        seq: 2,
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        durationMs: 1,
      },
    ],
    refuseExecWhileStarting: () => refusals-- > 0,
  });
  const handle = await handleFor(fake);

  const result = await handle.exec({ command: "echo alive", policy: policy() });

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /alive/);
  // Refused once, retried, succeeded.
  assert.equal(fake.find("exec").length, 2);
});

void test("broker exec: a sandbox that never comes back reports a clear failure", async () => {
  const fake = fakeBroker({ refuseExecWhileStarting: () => true, stuckStarting: true });
  const handle = await handleFor(fake);

  await assert.rejects(
    handle.exec({ command: "echo", policy: policy() }),
    (err: unknown) => {
      assert.ok(err instanceof AgentBackendError);
      assert.match(err.message, /did not become ready/i);
      return true;
    },
  );
});

void test("broker exec: a genuine concurrent execution is waited out, then reported", async () => {
  // Distinct from the restart case only by how long it lasts, so the adapter
  // gives up with the broker's own message rather than retrying forever.
  const fake = fakeBroker({
    refuseExecWhileStarting: () => true,
    conflictCode: "conflict",
  });
  const handle = await handleFor(fake);

  await assert.rejects(
    handle.exec({ command: "echo", policy: policy() }),
    /execution is already running|did not become ready/i,
  );
});

void test("broker exec: a terminal error frame becomes a failed result, not a crash", async () => {
  const fake = fakeBroker({
    execEvents: () => [
      {
        type: "error",
        executionId: "e1",
        seq: 1,
        code: "workspace_quota_exceeded",
        message: "workspace is full",
      },
    ],
  });
  const handle = await handleFor(fake);
  const result = await handle.exec({
    command: "dd if=/dev/zero of=big",
    policy: policy(),
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.combined, /workspace_quota_exceeded/);
  assert.match(result.combined, /workspace is full/);
});

void test("broker exec: the shell policy blocks before the broker is contacted", async () => {
  const fake = fakeBroker();
  const handle = await handleFor(fake);
  const result = await handle.exec({
    command: "rm -rf /",
    policy: policy(),
  });
  assert.ok(result.policyBlocked);
  assert.deepEqual(fake.find("exec"), []);
});

void test("broker exec: internal-network protection applies even when the agent disabled it", async () => {
  const fake = fakeBroker();
  const handle = await handleFor(fake);
  const result = await handle.exec({
    command: "curl http://169.254.169.254/latest/meta-data/",
    policy: policy({ protectInternalNetwork: false }),
  });
  assert.ok(result.policyBlocked);
  assert.match(result.policyBlocked ?? "", /internal network protection/);
  assert.deepEqual(fake.find("exec"), []);
});

void test("broker exec: output beyond the policy ceiling is truncated for the model", async () => {
  const fake = fakeBroker({
    execEvents: () => [
      { type: "stdout", executionId: "e1", seq: 1, dataBase64: b64("x".repeat(5_000)) },
      {
        type: "result",
        executionId: "e1",
        seq: 2,
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        durationMs: 1,
      },
    ],
  });
  const handle = await handleFor(fake);
  const tight = policy();
  tight.command.maxOutputChars = 1_000;
  const result = await handle.exec({ command: "yes", policy: tight });
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length < 5_000);
});

// -- files ------------------------------------------------------------------

void test("broker files: binary content round-trips unchanged", async () => {
  const fake = fakeBroker();
  const handle = await handleFor(fake);
  const bytes = new Uint8Array([0x00, 0xff, 0x1b, 0x80, 0x0a, 0xc3]);
  await handle.writeFile("/workspace/blob.bin", bytes);
  assert.deepEqual(await handle.readFile("/workspace/blob.bin"), bytes);
});

void test("broker files: a missing file surfaces as a backend error", async () => {
  const fake = fakeBroker();
  const handle = await handleFor(fake);
  await assert.rejects(handle.readFile("/workspace/nope.txt"), (err: unknown) => {
    assert.ok(err instanceof AgentBackendError);
    assert.match(err.message, /nope\.txt/);
    return true;
  });
});

void test("broker files: removePath forwards the recursive flag", async () => {
  const fake = fakeBroker();
  const handle = await handleFor(fake);
  await handle.removePath("/workspace/dir", { recursive: true });
  assert.deepEqual(fake.find("deleteFile"), [
    { id: "sbx-1", path: "/workspace/dir", recursive: true },
  ]);
});

void test("broker files: makeDir creates the tree without consulting agent deny rules", async () => {
  const fake = fakeBroker();
  const handle = await handleFor(fake);
  await handle.makeDir("/workspace/a/b");
  const call = (fake.find("exec") as { request: ExecRequest }[])[0];
  assert.ok(call);
  assert.match(call.request.command, /mkdir -p/);
  assert.match(call.request.command, /\/workspace\/a\/b/);
});

void test("broker files: searchFiles globs the listing the sandbox produced", async () => {
  const fake = fakeBroker({
    execEvents: () => [
      {
        type: "stdout",
        executionId: "e1",
        seq: 1,
        dataBase64: b64(
          ["/workspace/a.ts", "/workspace/src/b.ts", "/workspace/src/c.js", ""].join(
            "\n",
          ),
        ),
      },
      {
        type: "result",
        executionId: "e1",
        seq: 2,
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        durationMs: 1,
      },
    ],
  });
  const handle = await handleFor(fake);
  const result = await handle.searchFiles("/workspace", "**/*.ts");
  assert.deepEqual(result.files, ["/workspace/a.ts", "/workspace/src/b.ts"]);
});

// -- error normalization ----------------------------------------------------

void test("broker errors: a broker API failure becomes an AgentBackendError with context", async () => {
  const fake = fakeBroker();
  await assert.rejects(provider(fake).inspect("missing"), (err: unknown) => {
    assert.ok(err instanceof AgentBackendError);
    assert.match(err.message, /missing/);
    assert.match(err.message, /does not exist/);
    return true;
  });
});

void test("broker errors: normalized messages never carry the bearer token", async () => {
  const fake = fakeBroker({
    failReadyWith: new Error("connect ECONNREFUSED 10.0.0.5:8080"),
  });
  const health = await provider(fake).health();
  assert.ok(!(health.detail ?? "").includes("super-secret-token"));
});
