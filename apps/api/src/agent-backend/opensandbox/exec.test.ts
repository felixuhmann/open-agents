import assert from "node:assert/strict";
import test from "node:test";
import type { CommandExecution, ExecutionHandlers } from "@alibaba-group/opensandbox";
import {
  formatCommandResult,
  resetShellSessions,
  runSandboxCommand,
  type ExecCommandsHandle,
} from "./exec.js";

type Script = (handlers?: ExecutionHandlers) => Promise<CommandExecution>;

type FakeHandle = ExecCommandsHandle & {
  createdSessions: number;
  interrupted: string[];
};

function makeHandle(script: Script, opts: { id?: string } = {}): FakeHandle {
  const handle: FakeHandle = {
    id: opts.id ?? "sbx-test",
    createdSessions: 0,
    interrupted: [],
    createSession() {
      handle.createdSessions += 1;
      return Promise.resolve("session-1");
    },
    runInSession(_sessionId, _command, _options, handlers, signal) {
      if (signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      }
      return script(handlers);
    },
    interrupt(sessionId) {
      handle.interrupted.push(sessionId);
      return Promise.resolve();
    },
  };
  return handle;
}

function completedExecution(overrides: Partial<CommandExecution> = {}): CommandExecution {
  return {
    logs: { stdout: [], stderr: [] },
    result: [],
    complete: { timestamp: 1, executionTimeMs: 5 },
    exitCode: 0,
    ...overrides,
  };
}

void test("normalizes stdout/stderr and exit code, streaming output chunks live", async () => {
  resetShellSessions();
  const chunks: string[] = [];
  const handle = makeHandle(async (handlers) => {
    await handlers?.onStdout?.({ text: "hello\n", timestamp: 1 });
    await handlers?.onStderr?.({ text: "warn\n", timestamp: 2 });
    return completedExecution({
      logs: {
        stdout: [{ text: "hello\n", timestamp: 1 }],
        stderr: [{ text: "warn\n", timestamp: 2 }],
      },
      exitCode: 0,
    });
  });
  const result = await runSandboxCommand({
    handle,
    command: "echo hello",
    cwd: "/workspace",
    workspaceDir: "/workspace",
    onOutput: (c) => chunks.push(`${c.stream}:${c.text}`),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello\n");
  assert.equal(result.stderr, "warn\n");
  assert.ok(chunks.includes("stdout:hello\n"));
  assert.ok(chunks.includes("stderr:warn\n"));
  const formatted = formatCommandResult(result);
  assert.match(formatted, /exitCode: 0/);
});

void test("reuses one persistent session across commands in the same sandbox", async () => {
  resetShellSessions();
  const handle = makeHandle(() => Promise.resolve(completedExecution()));
  await runSandboxCommand({
    handle,
    command: "a",
    cwd: "/workspace",
    workspaceDir: "/workspace",
  });
  await runSandboxCommand({
    handle,
    command: "b",
    cwd: "/workspace",
    workspaceDir: "/workspace",
  });
  assert.equal(handle.createdSessions, 1);
});

void test("policy-blocked commands never reach the sandbox", async () => {
  resetShellSessions();
  let ran = false;
  const handle = makeHandle(() => {
    ran = true;
    return Promise.resolve(completedExecution());
  });
  const result = await runSandboxCommand({
    handle,
    command: "rm -rf /",
    cwd: "/workspace",
    workspaceDir: "/workspace",
  });
  assert.equal(ran, false);
  assert.ok(result.policyBlocked);
  assert.equal(result.exitCode, 1);
});

void test("a hung command times out, interrupts the session, and reports exit 124", async () => {
  resetShellSessions();
  const handle = makeHandle(
    () => new Promise<CommandExecution>(() => undefined), // never resolves
  );
  const result = await runSandboxCommand({
    handle,
    command: "sleep 999",
    cwd: "/workspace",
    workspaceDir: "/workspace",
    timeoutSeconds: 1,
  });
  assert.equal(result.exitCode, 124);
  assert.match(result.stderr, /timed out/);
  assert.deepEqual(handle.interrupted, ["session-1"]);
});

void test("an aborted signal cancels the command and reports exit 130", async () => {
  resetShellSessions();
  const handle = makeHandle(() => Promise.resolve(completedExecution()));
  const controller = new AbortController();
  controller.abort();
  const result = await runSandboxCommand({
    handle,
    command: "long-task",
    cwd: "/workspace",
    workspaceDir: "/workspace",
    signal: controller.signal,
  });
  assert.equal(result.exitCode, 130);
  assert.match(result.combined, /cancelled/);
});

void test("output over the policy limit is truncated", async () => {
  resetShellSessions();
  const big = "x".repeat(50);
  const handle = makeHandle(() =>
    Promise.resolve(
      completedExecution({ logs: { stdout: [{ text: big, timestamp: 1 }], stderr: [] } }),
    ),
  );
  const result = await runSandboxCommand({
    handle,
    command: "cat big",
    cwd: "/workspace",
    workspaceDir: "/workspace",
    policy: {
      command: {
        denyRules: [],
        approvalGatePatterns: [],
        maxRuntimeSeconds: 60,
        maxOutputChars: 10,
        maxBackgroundProcessLifetimeSeconds: 600,
      },
    },
  });
  assert.equal(result.truncated, true);
  assert.match(result.stdout, /truncated/);
});
