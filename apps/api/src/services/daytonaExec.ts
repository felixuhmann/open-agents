import type { Sandbox } from "@daytona/sdk";
import { log } from "../log.js";
import { shellQuote } from "./daytonaShell.js";
import {
  DEFAULT_BASH_TIMEOUT_SECONDS,
  MAX_BASH_TIMEOUT_SECONDS,
  MAX_TOOL_OUTPUT_CHARS,
  TOOL_OUTPUT_EMIT_INTERVAL_MS,
  TOOL_OUTPUT_EMIT_MIN_CHARS,
  truncateText,
} from "./daytonaLimits.js";
import { checkShellCommand } from "./shellPolicy.js";

const SHELL_SESSION_ID = "open-agents-shell";

type ShellSessionState = {
  ready: Promise<void>;
  cwd: string;
};

const shellSessions = new Map<string, ShellSessionState>();

export type CommandStream = "stdout" | "stderr";

export type CommandOutputChunk = {
  stream: CommandStream;
  text: string;
};

export type RunSandboxCommandInput = {
  sandbox: Sandbox;
  command: string;
  cwd: string;
  workspaceDir: string;
  timeoutSeconds?: number;
  onOutput?: (chunk: CommandOutputChunk) => void;
};

export type RunSandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
  truncated: boolean;
  policyBlocked?: string;
};

function clampTimeout(seconds: number | undefined): number {
  const value = seconds ?? DEFAULT_BASH_TIMEOUT_SECONDS;
  return Math.max(1, Math.min(value, MAX_BASH_TIMEOUT_SECONDS));
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
  sandbox: Sandbox,
  workspaceDir: string,
): Promise<ShellSessionState> {
  const key = sandbox.id;
  const existing = shellSessions.get(key);
  if (existing) {
    await existing.ready;
    return existing;
  }

  let resolveReady!: () => void;
  let rejectReady!: (err: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const state: ShellSessionState = { ready, cwd: workspaceDir };
  shellSessions.set(key, state);

  void (async () => {
    try {
      try {
        await sandbox.process.getSession(SHELL_SESSION_ID);
      } catch {
        await sandbox.process.createSession(SHELL_SESSION_ID);
        await sandbox.process.executeSessionCommand(SHELL_SESSION_ID, {
          command: `cd ${shellQuote(workspaceDir)}`,
        });
      }
      state.cwd = workspaceDir;
      resolveReady();
    } catch (err) {
      shellSessions.delete(key);
      rejectReady(err);
      throw err;
    }
  })();

  await ready;
  return state;
}

async function maybeChangeDirectory(
  sandbox: Sandbox,
  state: ShellSessionState,
  cwd: string,
): Promise<void> {
  if (state.cwd === cwd) return;
  await sandbox.process.executeSessionCommand(SHELL_SESSION_ID, {
    command: `cd ${shellQuote(cwd)}`,
  });
  state.cwd = cwd;
}

/**
 * Run a command in a persistent Daytona process session. Output is streamed
 * via {@link RunSandboxCommandInput.onOutput} when provided; the returned
 * strings are truncated for model consumption.
 */
export async function runSandboxCommand(
  input: RunSandboxCommandInput,
): Promise<RunSandboxCommandResult> {
  const policy = checkShellCommand(input.command);
  if (!policy.allowed) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `policy blocked: ${policy.reason}`,
      combined: `policy blocked: ${policy.reason}`,
      truncated: false,
      policyBlocked: policy.reason,
    };
  }

  const timeoutSeconds = clampTimeout(input.timeoutSeconds);
  const timeoutMs = timeoutSeconds * 1000;
  const targetCwd = input.cwd || input.workspaceDir;

  const state = await ensureShellSession(input.sandbox, input.workspaceDir);
  await maybeChangeDirectory(input.sandbox, state, targetCwd);

  const batcher = createOutputBatcher(input.onOutput);

  const started = await input.sandbox.process.executeSessionCommand(
    SHELL_SESSION_ID,
    { command: input.command, runAsync: true },
    timeoutSeconds,
  );
  const cmdId = started.cmdId;
  if (!cmdId) {
    throw new Error("Daytona did not return cmdId for async session command");
  }

  const logsPromise = input.sandbox.process.getSessionCommandLogs(
    SHELL_SESSION_ID,
    cmdId,
    (chunk) => batcher.onChunk("stdout", chunk),
    (chunk) => batcher.onChunk("stderr", chunk),
  );

  let exitCode: number;
  try {
    await Promise.race([
      logsPromise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(new Error(`command timed out after ${Math.round(timeoutMs / 1000)}s`)),
          timeoutMs,
        );
      }),
    ]);
    const cmd = await input.sandbox.process.getSessionCommand(SHELL_SESSION_ID, cmdId);
    exitCode = cmd.exitCode ?? 124;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logsPromise.catch((logErr) => {
      log.warn("daytona: log stream ended with error", {
        sandboxId: input.sandbox.id,
        cmdId,
        err: logErr instanceof Error ? logErr.message : String(logErr),
      });
    });
    batcher.finish();
    return {
      exitCode: 124,
      stdout: "",
      stderr: message,
      combined: message,
      truncated: false,
    };
  }

  const { stdout, stderr } = batcher.finish();
  const combined = [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : "");
  const truncatedStdout = truncateText(stdout, MAX_TOOL_OUTPUT_CHARS, "stdout");
  const truncatedStderr = truncateText(stderr, MAX_TOOL_OUTPUT_CHARS, "stderr");
  const truncatedCombined = truncateText(
    combined || `(exit ${exitCode})`,
    MAX_TOOL_OUTPUT_CHARS,
    "output",
  );

  return {
    exitCode,
    stdout: truncatedStdout.text,
    stderr: truncatedStderr.text,
    combined: truncatedCombined.text,
    truncated:
      truncatedStdout.truncated ||
      truncatedStderr.truncated ||
      truncatedCombined.truncated,
  };
}

export function formatCommandResult(result: RunSandboxCommandResult): string {
  const parts = [`exitCode: ${result.exitCode}`];
  if (result.policyBlocked) {
    parts.push(`policy: ${result.policyBlocked}`);
  }
  if (result.truncated) {
    parts.push("(output truncated for model)");
  }
  if (result.combined) {
    parts.push("", result.combined);
  }
  return parts.join("\n");
}
