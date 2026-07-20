import type {
  CommandExecution,
  ExecutionHandlers,
  OutputMessage,
} from "@alibaba-group/opensandbox";
import type { SandboxCommandPolicy, SandboxNetworkPolicy } from "@open-agents/types";
import { log } from "../../log.js";
import {
  DEFAULT_BASH_TIMEOUT_SECONDS,
  TOOL_OUTPUT_EMIT_INTERVAL_MS,
  TOOL_OUTPUT_EMIT_MIN_CHARS,
  truncateText,
} from "../../services/sandboxLimits.js";
import {
  checkShellCommand,
  type ShellPolicyContext,
} from "../../services/shellPolicy.js";

export type CommandStream = "stdout" | "stderr";

export type CommandOutputChunk = {
  stream: CommandStream;
  text: string;
};

/**
 * Narrow, injectable view of an OpenSandbox execd command session. The real
 * implementation delegates to the SDK's `Sandbox.commands`; tests supply a fake
 * so command behavior is verifiable without a live Kata host.
 */
export type ExecCommandsHandle = {
  /** Stable sandbox id; used to cache one persistent bash session per sandbox. */
  readonly id: string;
  createSession(workingDirectory: string): Promise<string>;
  runInSession(
    sessionId: string,
    command: string,
    options: { workingDirectory?: string; timeoutSeconds?: number },
    handlers?: ExecutionHandlers,
    signal?: AbortSignal,
  ): Promise<CommandExecution>;
  interrupt(sessionId: string): Promise<void>;
};

export type RunSandboxCommandInput = {
  handle: ExecCommandsHandle;
  command: string;
  cwd: string;
  workspaceDir: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: CommandOutputChunk) => void;
  policy?: {
    network?: SandboxNetworkPolicy;
    command?: SandboxCommandPolicy;
  };
};

export type RunSandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
  truncated: boolean;
  policyBlocked?: string;
};

type ShellSessionState = { ready: Promise<string> };

// One persistent execd session per sandbox id. Session state (cwd/env) carries
// between calls, matching the previous provider's persistent shell semantics.
const shellSessions = new Map<string, ShellSessionState>();

/** Test hook: forget cached sessions so a fresh fake handle starts clean. */
export function resetShellSessions(): void {
  shellSessions.clear();
}

function resolveCommandPolicy(policy?: SandboxCommandPolicy): {
  maxRuntimeSeconds: number;
  maxOutputChars: number;
  maxBackgroundProcessLifetimeSeconds: number;
} {
  return {
    maxRuntimeSeconds: policy?.maxRuntimeSeconds ?? DEFAULT_BASH_TIMEOUT_SECONDS,
    maxOutputChars: policy?.maxOutputChars ?? 20_000,
    maxBackgroundProcessLifetimeSeconds:
      policy?.maxBackgroundProcessLifetimeSeconds ?? 600,
  };
}

function clampTimeout(
  seconds: number | undefined,
  policy?: SandboxCommandPolicy,
): number {
  const limits = resolveCommandPolicy(policy);
  const ceiling = Math.min(
    limits.maxRuntimeSeconds,
    limits.maxBackgroundProcessLifetimeSeconds,
  );
  const value = seconds ?? limits.maxRuntimeSeconds;
  return Math.max(1, Math.min(value, ceiling));
}

function createOutputBatcher(onOutput?: (chunk: CommandOutputChunk) => void) {
  let stdoutBuf = "";
  let stderrBuf = "";
  let lastEmitAt = 0;
  let stdoutPending = "";
  let stderrPending = "";

  const flush = (stream: CommandStream, pending: string): string => {
    if (!pending || !onOutput) return "";
    onOutput({ stream, text: pending });
    return "";
  };

  const maybeFlush = (force: boolean) => {
    const now = Date.now();
    const due =
      force ||
      now - lastEmitAt >= TOOL_OUTPUT_EMIT_INTERVAL_MS ||
      stdoutPending.length >= TOOL_OUTPUT_EMIT_MIN_CHARS ||
      stderrPending.length >= TOOL_OUTPUT_EMIT_MIN_CHARS;
    if (!due) return;
    stdoutPending = flush("stdout", stdoutPending);
    stderrPending = flush("stderr", stderrPending);
    lastEmitAt = now;
  };

  return {
    onChunk(stream: CommandStream, chunk: string) {
      if (stream === "stdout") {
        stdoutBuf += chunk;
        stdoutPending += chunk;
      } else {
        stderrBuf += chunk;
        stderrPending += chunk;
      }
      maybeFlush(false);
    },
    finish() {
      maybeFlush(true);
      stdoutPending = flush("stdout", stdoutPending);
      stderrPending = flush("stderr", stderrPending);
      return { stdout: stdoutBuf, stderr: stderrBuf };
    },
  };
}

async function ensureShellSession(
  handle: ExecCommandsHandle,
  cwd: string,
): Promise<string> {
  const existing = shellSessions.get(handle.id);
  if (existing) return existing.ready;
  const ready = handle.createSession(cwd).catch((err) => {
    shellSessions.delete(handle.id);
    throw err;
  });
  shellSessions.set(handle.id, { ready });
  return ready;
}

function joinMessages(messages: OutputMessage[] | undefined): string {
  if (!messages?.length) return "";
  return messages.map((m) => m.text).join("");
}

/**
 * Run a command in the sandbox's persistent execd session. Output is streamed
 * via `onOutput` when provided; returned strings are truncated for the model.
 * Command policy is enforced before execution; timeout and cancellation are
 * both honored (server-enforced timeout plus a client-side guard and abort).
 */
export async function runSandboxCommand(
  input: RunSandboxCommandInput,
): Promise<RunSandboxCommandResult> {
  const shellCtx: ShellPolicyContext = {
    network: input.policy?.network,
    command: input.policy?.command,
  };
  const verdict = checkShellCommand(input.command, shellCtx);
  if (!verdict.allowed) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `policy blocked: ${verdict.reason}`,
      combined: `policy blocked: ${verdict.reason}`,
      truncated: false,
      policyBlocked: verdict.reason,
    };
  }

  const limits = resolveCommandPolicy(input.policy?.command);
  const timeoutSeconds = clampTimeout(input.timeoutSeconds, input.policy?.command);
  const targetCwd = input.cwd || input.workspaceDir;

  const sessionId = await ensureShellSession(input.handle, input.workspaceDir);
  const batcher = createOutputBatcher(input.onOutput);
  const handlers: ExecutionHandlers = {
    skipAccumulation: false,
    onStdout: (msg) => batcher.onChunk("stdout", msg.text),
    onStderr: (msg) => batcher.onChunk("stderr", msg.text),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void input.handle.interrupt(sessionId).catch(() => undefined);
      reject(new Error(`command timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);
  });

  let execution: CommandExecution;
  try {
    execution = await Promise.race([
      input.handle.runInSession(
        sessionId,
        input.command,
        { workingDirectory: targetCwd, timeoutSeconds },
        handlers,
        input.signal,
      ),
      timeoutPromise,
    ]);
  } catch (err) {
    if (timer) clearTimeout(timer);
    batcher.finish();
    if (input.signal?.aborted) {
      await input.handle.interrupt(sessionId).catch(() => undefined);
      return {
        exitCode: 130,
        stdout: "",
        stderr: "command cancelled",
        combined: "command cancelled",
        truncated: false,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    log.warn("opensandbox: command failed", { sandboxId: input.handle.id, err: message });
    return {
      exitCode: 124,
      stdout: "",
      stderr: message,
      combined: message,
      truncated: false,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const { stdout: liveOut, stderr: liveErr } = batcher.finish();
  const stdout = liveOut || joinMessages(execution.logs?.stdout);
  const stderr = liveErr || joinMessages(execution.logs?.stderr);
  const exitCode = execution.exitCode ?? (execution.error ? 1 : 0);
  const combined = [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : "");
  const maxOut = limits.maxOutputChars;
  const tStdout = truncateText(stdout, maxOut, "stdout");
  const tStderr = truncateText(stderr, maxOut, "stderr");
  const tCombined = truncateText(combined || `(exit ${exitCode})`, maxOut, "output");

  return {
    exitCode,
    stdout: tStdout.text,
    stderr: tStderr.text,
    combined: tCombined.text,
    truncated: tStdout.truncated || tStderr.truncated || tCombined.truncated,
  };
}

export function formatCommandResult(result: RunSandboxCommandResult): string {
  const parts = [`exitCode: ${result.exitCode}`];
  if (result.policyBlocked) parts.push(`policy: ${result.policyBlocked}`);
  if (result.truncated) parts.push("(output truncated for model)");
  if (result.combined) parts.push("", result.combined);
  return parts.join("\n");
}
