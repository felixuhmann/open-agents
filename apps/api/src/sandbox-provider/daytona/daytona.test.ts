import assert from "node:assert/strict";
import test from "node:test";
import { AgentBackendError } from "../../agent-backend/types.js";
import { DaytonaSandboxProvider } from "./index.js";
import type {
  DaytonaClientLike,
  DaytonaSandboxLike,
  DaytonaSessionCommandLike,
} from "./client.js";

/**
 * Characterization of the Daytona adapter. Everything here mirrors what the
 * monolithic `DaytonaAgentBackend` did against the SDK before the split:
 * create options, labels, workspace-dir discovery, persistent shell session,
 * Files API semantics, lifecycle transitions, and error wrapping.
 *
 * The SDK client is injected structurally so none of this needs credentials
 * or a database.
 */

type FakeSandboxOptions = {
  id: string;
  state?: string;
  workDir?: string;
  homeDir?: string;
  errorReason?: string;
  recoverable?: boolean;
  lastActivityAt?: string;
  labels?: Record<string, string>;
};

function fakeSandbox(options: FakeSandboxOptions) {
  const calls: string[] = [];
  const files = new Map<string, Buffer>();
  const folders: string[] = [];
  const commands: string[] = [];
  const networkSettings: Record<string, unknown>[] = [];
  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  let sessionExists = false;

  const sandbox: DaytonaSandboxLike = {
    id: options.id,
    state: options.state ?? "started",
    errorReason: options.errorReason,
    recoverable: options.recoverable,
    lastActivityAt: options.lastActivityAt,
    labels: options.labels,
    getWorkDir: () => Promise.resolve(options.workDir),
    getUserHomeDir: () => Promise.resolve(options.homeDir),
    start: (timeout?: number) => {
      calls.push(`start:${timeout ?? ""}`);
      sandbox.state = "started";
      return Promise.resolve();
    },
    stop: (timeout?: number) => {
      calls.push(`stop:${timeout ?? ""}`);
      sandbox.state = "stopped";
      return Promise.resolve();
    },
    archive: () => {
      calls.push("archive");
      sandbox.state = "archived";
      return Promise.resolve();
    },
    recover: (timeout?: number) => {
      calls.push(`recover:${timeout ?? ""}`);
      sandbox.state = "stopped";
      return Promise.resolve();
    },
    delete: (timeout?: number) => {
      calls.push(`delete:${timeout ?? ""}`);
      sandbox.state = "deleted";
      return Promise.resolve();
    },
    refreshActivity: () => {
      calls.push("refreshActivity");
      return Promise.resolve();
    },
    updateNetworkSettings: (settings) => {
      networkSettings.push({ ...settings });
      return Promise.resolve();
    },
    fs: {
      createFolder: (path: string, mode: string) => {
        folders.push(`${path}:${mode}`);
        return Promise.resolve();
      },
      uploadFile: (content: Buffer, remotePath: string) => {
        files.set(remotePath, content);
        return Promise.resolve();
      },
      downloadFile: (remotePath: string) => {
        const found = files.get(remotePath);
        if (!found) return Promise.reject(new Error(`no such file: ${remotePath}`));
        return Promise.resolve(found);
      },
      deleteFile: (remotePath: string, recursive?: boolean) => {
        calls.push(`deleteFile:${remotePath}:${recursive ?? false}`);
        files.delete(remotePath);
        return Promise.resolve();
      },
      searchFiles: (root: string, pattern: string) =>
        Promise.resolve({ files: [`${root}/match-${pattern}`] }),
    },
    process: {
      getSession: (sessionId: string) => {
        if (!sessionExists) return Promise.reject(new Error("no session"));
        return Promise.resolve({ sessionId });
      },
      createSession: (sessionId: string) => {
        sessionExists = true;
        calls.push(`createSession:${sessionId}`);
        return Promise.resolve();
      },
      executeSessionCommand: (
        _sessionId: string,
        request: { command: string; runAsync?: boolean },
      ) => {
        commands.push(request.command);
        return Promise.resolve({ cmdId: `cmd-${commands.length}` });
      },
      getSessionCommandLogs: (
        _sessionId: string,
        _cmdId: string,
        onStdout: (chunk: string) => void,
        onStderr: (chunk: string) => void,
      ) => {
        if (stdout) onStdout(stdout);
        if (stderr) onStderr(stderr);
        return Promise.resolve();
      },
      getSessionCommand: (): Promise<DaytonaSessionCommandLike> =>
        Promise.resolve({ exitCode }),
    },
  };

  return {
    sandbox,
    calls,
    files,
    folders,
    commands,
    networkSettings,
    setResult(next: { exitCode?: number; stdout?: string; stderr?: string }) {
      exitCode = next.exitCode ?? 0;
      stdout = next.stdout ?? "";
      stderr = next.stderr ?? "";
    },
  };
}

function fakeClient(sandbox: DaytonaSandboxLike, extra?: DaytonaSandboxLike[]) {
  const created: Record<string, unknown>[] = [];
  const client: DaytonaClientLike = {
    create: (params) => {
      created.push({ ...params });
      return Promise.resolve(sandbox);
    },
    get: (id: string) => {
      if (id === sandbox.id) return Promise.resolve(sandbox);
      const found = extra?.find((s) => s.id === id);
      if (found) return Promise.resolve(found);
      return Promise.reject(new Error(`Sandbox not found: ${id} (HTTP 404)`));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    list: async function* () {
      yield sandbox;
      for (const s of extra ?? []) yield s;
    },
  };
  return { client, created };
}

const OPEN_POLICY = {
  network: { internetEnabled: true, allowList: "", protectInternalNetwork: true },
  command: {
    denyRules: [],
    approvalGatePatterns: [],
    maxRuntimeSeconds: 60,
    maxOutputChars: 20_000,
    maxBackgroundProcessLifetimeSeconds: 600,
  },
};

function providerFor(client: DaytonaClientLike) {
  return new DaytonaSandboxProvider({ createClient: () => client });
}

void test("capabilities advertise Daytona's real feature set", () => {
  const { client } = fakeClient(fakeSandbox({ id: "sbx-cap" }).sandbox);
  const provider = providerFor(client);

  assert.equal(provider.id, "daytona");
  assert.deepEqual(
    [...provider.capabilities.networkModes].sort(),
    ["cidr-allowlist", "deny-all", "unrestricted"],
  );
  assert.equal(provider.capabilities.archive, true);
  assert.equal(provider.capabilities.recover, true);
});

void test("Daytona accepts a CIDR allowlist policy", () => {
  const { client } = fakeClient(fakeSandbox({ id: "sbx-policy" }).sandbox);
  const provider = providerFor(client);

  assert.doesNotThrow(() => provider.validatePolicy(OPEN_POLICY));
  assert.doesNotThrow(() =>
    provider.validatePolicy({
      ...OPEN_POLICY,
      network: { ...OPEN_POLICY.network, allowList: "10.0.0.0/8" },
    }),
  );
  assert.doesNotThrow(() =>
    provider.validatePolicy({
      ...OPEN_POLICY,
      network: { ...OPEN_POLICY.network, internetEnabled: false },
    }),
  );
});

void test("create passes the agent labels, lifecycle, and network options through", async () => {
  const fake = fakeSandbox({ id: "sbx-create", workDir: "/home/daytona" });
  const { client, created } = fakeClient(fake.sandbox);
  const provider = providerFor(client);

  const handle = await provider.create({
    agentId: "agent_1",
    agentSlug: "researcher",
    policy: {
      ...OPEN_POLICY,
      network: { ...OPEN_POLICY.network, internetEnabled: false },
    },
    lifecycle: {
      autoStopInterval: 15,
      autoArchiveInterval: 10_080,
      autoDeleteInterval: -1,
    },
  });

  const params = created[0]!;
  assert.equal(params.language, "typescript");
  assert.equal(params.autoStopInterval, 15);
  assert.equal(params.autoArchiveInterval, 10_080);
  assert.equal(params.autoDeleteInterval, -1);
  assert.deepEqual(params.labels, {
    "open-agents-agent-id": "agent_1",
    "open-agents-agent-slug": "researcher",
  });
  assert.equal(params.networkBlockAll, true);
  assert.match(String(params.name), /^oa-researcher-[0-9a-f]{8}$/);

  // internetEnabled:false is also re-asserted on the live sandbox.
  assert.deepEqual(fake.networkSettings, [{ networkBlockAll: true }]);

  assert.equal(handle.provider, "daytona");
  assert.equal(handle.providerSandboxId, "sbx-create");
  assert.equal(handle.workspaceDir, "/home/daytona");
});

void test("workspace dir falls back from workDir to home dir to /workspace", async () => {
  for (const [options, expected] of [
    [{ id: "sbx-wd-1", workDir: "/home/daytona/" }, "/home/daytona"],
    [{ id: "sbx-wd-2", homeDir: "/root" }, "/root"],
    [{ id: "sbx-wd-3" }, "/workspace"],
  ] as const) {
    const { client } = fakeClient(fakeSandbox(options).sandbox);
    const handle = await providerFor(client).connect(options.id);
    assert.equal(handle.workspaceDir, expected);
  }
});

void test("file operations use the Daytona Files API with absolute paths", async () => {
  const fake = fakeSandbox({ id: "sbx-files", workDir: "/home/daytona" });
  const { client } = fakeClient(fake.sandbox);
  const handle = await providerFor(client).connect("sbx-files");

  await handle.writeFile("/home/daytona/out/report.txt", new TextEncoder().encode("hi"));
  assert.equal(fake.files.get("/home/daytona/out/report.txt")?.toString("utf8"), "hi");

  const read = await handle.readFile("/home/daytona/out/report.txt");
  assert.equal(new TextDecoder().decode(read), "hi");

  // The directory walk starts at the filesystem root and swallows
  // already-exists errors per segment.
  assert.deepEqual(fake.folders, [
    "/home:755",
    "/home/daytona:755",
    "/home/daytona/out:755",
  ]);

  fake.folders.length = 0;
  await handle.makeDir("/home/daytona/a/b");
  assert.deepEqual(fake.folders, [
    "/home:755",
    "/home/daytona:755",
    "/home/daytona/a:755",
    "/home/daytona/a/b:755",
  ]);

  const search = await handle.searchFiles("/home/daytona", "*.ts");
  assert.deepEqual(search, { files: ["/home/daytona/match-*.ts"] });

  await handle.removePath("/home/daytona/out", { recursive: true });
  assert.ok(fake.calls.includes("deleteFile:/home/daytona/out:true"));
});

void test("writeFile creates the parent directory tree first", async () => {
  const fake = fakeSandbox({ id: "sbx-mkdirp", workDir: "/workspace" });
  const { client } = fakeClient(fake.sandbox);
  const handle = await providerFor(client).connect("sbx-mkdirp");

  await handle.writeFile("/workspace/inbox/deep/a.txt", new Uint8Array([1]));

  assert.deepEqual(fake.folders, [
    "/workspace:755",
    "/workspace/inbox:755",
    "/workspace/inbox/deep:755",
  ]);
  assert.ok(fake.files.has("/workspace/inbox/deep/a.txt"));
});

void test("exec runs through one persistent shell session and reports the exit code", async () => {
  const fake = fakeSandbox({ id: "sbx-exec", workDir: "/workspace" });
  fake.setResult({ exitCode: 0, stdout: "hello\n" });
  const { client } = fakeClient(fake.sandbox);
  const handle = await providerFor(client).connect("sbx-exec");

  const chunks: string[] = [];
  const result = await handle.exec({
    command: "echo hello",
    policy: OPEN_POLICY,
    onOutput: (chunk) => chunks.push(`${chunk.stream}:${chunk.text}`),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello\n");
  assert.equal(result.combined, "hello\n");
  assert.equal(result.truncated, false);
  assert.deepEqual(chunks, ["stdout:hello\n"]);
  assert.ok(fake.calls.includes("createSession:open-agents-shell"));
  assert.ok(fake.commands.includes("echo hello"));
});

void test("exec surfaces a non-zero exit code and stderr", async () => {
  const fake = fakeSandbox({ id: "sbx-exec-fail", workDir: "/workspace" });
  fake.setResult({ exitCode: 2, stderr: "boom\n" });
  const { client } = fakeClient(fake.sandbox);
  const handle = await providerFor(client).connect("sbx-exec-fail");

  const result = await handle.exec({ command: "false", policy: OPEN_POLICY });

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "boom\n");
});

void test("exec refuses commands the shell policy denies without touching the sandbox", async () => {
  const fake = fakeSandbox({ id: "sbx-exec-policy", workDir: "/workspace" });
  const { client } = fakeClient(fake.sandbox);
  const handle = await providerFor(client).connect("sbx-exec-policy");

  const result = await handle.exec({
    command: "rm -rf /",
    policy: {
      ...OPEN_POLICY,
      command: { ...OPEN_POLICY.command, denyRules: ["rm\\s+-rf\\s+/"] },
    },
  });

  assert.equal(result.exitCode, 1);
  assert.ok(result.policyBlocked);
  assert.deepEqual(fake.commands, []);
});

void test("connect recovers an errored sandbox and starts a stopped one before use", async () => {
  const errored = fakeSandbox({ id: "sbx-err", state: "error", recoverable: true });
  const { client } = fakeClient(errored.sandbox);

  const handle = await providerFor(client).connect("sbx-err");

  assert.ok(errored.calls.some((call) => call.startsWith("recover:")));
  assert.ok(errored.calls.some((call) => call.startsWith("start:")));
  assert.ok(errored.calls.includes("refreshActivity"));
  assert.equal(handle.state, "started");
});

void test("connect refuses an unrecoverable errored sandbox", async () => {
  const broken = fakeSandbox({
    id: "sbx-broken",
    state: "error",
    recoverable: false,
    errorReason: "disk full",
  });
  const { client } = fakeClient(broken.sandbox);

  await assert.rejects(
    () => providerFor(client).connect("sbx-broken"),
    (err: unknown) => err instanceof AgentBackendError && err.message.includes("disk full"),
  );
});

void test("inspect maps provider state onto the normalized snapshot", async () => {
  const fake = fakeSandbox({
    id: "sbx-inspect",
    state: "error",
    errorReason: "quota exceeded",
    recoverable: true,
    lastActivityAt: "2026-01-03T00:00:00.000Z",
  });
  const { client } = fakeClient(fake.sandbox);

  const snapshot = await providerFor(client).inspect("sbx-inspect");

  assert.deepEqual(snapshot, {
    provider: "daytona",
    providerSandboxId: "sbx-inspect",
    state: "error",
    lastActivityAt: new Date("2026-01-03T00:00:00.000Z"),
    errorReason: "quota exceeded",
    recoverable: true,
  });
});

void test("stop, start, archive, recover, and delete only act when the state warrants it", async () => {
  const started = fakeSandbox({ id: "sbx-life", state: "started" });
  const provider = providerFor(fakeClient(started.sandbox).client);

  await provider.start("sbx-life");
  assert.equal(
    started.calls.some((call) => call.startsWith("start:")),
    false,
    "already-started sandbox is not restarted",
  );

  const stopped = await provider.stop("sbx-life");
  assert.equal(stopped.state, "stopped");
  assert.ok(started.calls.includes("stop:90"));

  await provider.start("sbx-life");
  assert.ok(started.calls.includes("start:90"));

  await provider.archive("sbx-life");
  assert.ok(started.calls.includes("archive"));

  await provider.delete("sbx-life");
  assert.ok(started.calls.includes("delete:90"));
});

void test("recover is a no-op unless the sandbox is errored and recoverable", async () => {
  const healthy = fakeSandbox({ id: "sbx-ok", state: "started" });
  await providerFor(fakeClient(healthy.sandbox).client).recover("sbx-ok");
  assert.equal(
    healthy.calls.some((call) => call.startsWith("recover:")),
    false,
  );

  const errored = fakeSandbox({ id: "sbx-rec", state: "error", recoverable: true });
  await providerFor(fakeClient(errored.sandbox).client).recover("sbx-rec");
  assert.ok(errored.calls.includes("recover:90"));
});

void test("listOwned yields only sandboxes carrying the open-agents label", async () => {
  const ours = fakeSandbox({
    id: "sbx-ours",
    labels: { "open-agents-agent-id": "agent_1" },
  });
  const theirs = fakeSandbox({ id: "sbx-theirs", labels: { team: "other" } });
  const { client } = fakeClient(ours.sandbox, [theirs.sandbox]);

  const seen = [];
  for await (const snapshot of providerFor(client).listOwned()) {
    seen.push(snapshot);
  }

  assert.deepEqual(
    seen.map((s) => s.providerSandboxId),
    ["sbx-ours"],
  );
  assert.equal(seen[0]?.agentId, "agent_1");
});

void test("provider failures surface as AgentBackendError with context", async () => {
  const { client } = fakeClient(fakeSandbox({ id: "sbx-present" }).sandbox);
  const provider = providerFor(client);

  await assert.rejects(
    () => provider.inspect("sbx-missing"),
    (err: unknown) =>
      err instanceof AgentBackendError && err.message.includes("sbx-missing"),
  );
});

void test("health reports available when the client can list sandboxes", async () => {
  const { client } = fakeClient(fakeSandbox({ id: "sbx-health" }).sandbox);
  assert.deepEqual(await providerFor(client).health(), { available: true });

  const broken: DaytonaClientLike = {
    ...client,
    // eslint-disable-next-line @typescript-eslint/require-await, require-yield
    list: async function* () {
      throw new Error("401 unauthorized");
    },
  };
  const health = await providerFor(broken).health();
  assert.equal(health.available, false);
  assert.ok(health.detail?.includes("401"));
});
