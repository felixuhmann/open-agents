import type { SandboxCommandPolicy, SandboxNetworkPolicy } from "@open-agents/types";
import { log } from "../../log.js";
import { shellQuote } from "../../services/sandboxShell.js";
import {
  blockedCommandResult,
  clampTimeout,
  createOutputBatcher,
  finalizeCommandResult,
  resolveCommandPolicy,
} from "../../services/sandboxExecOutput.js";
import {
  checkShellCommand,
  type ShellPolicyContext,
} from "../../services/shellPolicy.js";
import type { DaytonaSandboxLike } from "./client.js";

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
  sandbox: DaytonaSandboxLike;
  command: string;
  cwd: string;
  workspaceDir: string;
  timeoutSeconds?: number;
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

async function ensureShellSession(
  sandbox: DaytonaSandboxLike,
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
  sandbox: DaytonaSandboxLike,
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
  const shellCtx: ShellPolicyContext = {
    network: input.policy?.network,
    command: input.policy?.command,
  };
  const policyVerdict = checkShellCommand(input.command, shellCtx);
  if (!policyVerdict.allowed) {
    return blockedCommandResult(policyVerdict.reason);
  }

  const commandLimits = resolveCommandPolicy(input.policy?.command);
  const timeoutSeconds = clampTimeout(input.timeoutSeconds, input.policy?.command);
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
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      logsPromise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
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
  } finally {
    // Without this the pending timer keeps the event loop alive for the full
    // command budget after a fast command already returned.
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  const { stdout, stderr } = batcher.finish();
  return finalizeCommandResult({
    exitCode,
    stdout,
    stderr,
    maxOutputChars: commandLimits.maxOutputChars,
  });
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
