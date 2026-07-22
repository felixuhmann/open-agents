import {
  BrokerApiError,
  EXEC_CANCELLED_EXIT_CODE,
  MAX_EXEC_TIMEOUT_MS,
  type ExecEvent,
} from "@sandbox-broker/client";
import type { SandboxPolicyBundle } from "@open-agents/types";
import { AgentBackendError } from "../../agent-backend/types.js";
import {
  blockedCommandResult,
  clampTimeout,
  createOutputBatcher,
  finalizeCommandResult,
  resolveCommandPolicy,
  type OutputBatcher,
} from "../../services/sandboxExecOutput.js";
import { checkShellCommand } from "../../services/shellPolicy.js";
import type {
  SandboxCommandOutputChunk,
  SandboxCommandStream,
  SandboxExecResult,
} from "../types.js";
import type { BrokerClientLike } from "./client.js";
import { wrapBrokerError } from "./errors.js";
import { brokerEnforcedNetworkPolicy } from "./policy.js";

/**
 * Command execution over the broker's NDJSON exec stream.
 *
 * The broker owns the timeout, the cancellation, and the process tree; this
 * module only decodes frames, forwards output incrementally, and normalizes
 * the terminal frame into the provider-neutral {@link SandboxExecResult}.
 */

type StreamOutcome = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
  errorFrame: { code: string; message: string } | null;
};

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * How long to wait for the sandbox the broker recycles after a cancelled or
 * timed-out command. To guarantee no reparented process survives, the broker
 * stops the container, starts it again, and re-applies and re-verifies the
 * network policy before it will accept `exec` — which takes seconds.
 */
export const DEFAULT_RESTART_WAIT_MS = 60_000;
const RESTART_POLL_MS = 250;

/**
 * Is this the broker refusing `exec` because it is still recovering from the
 * *previous* command rather than because the caller did something wrong?
 *
 * Both flavours are transient residue of a cancellation or timeout:
 *   - `sandbox_error` + "is starting": the container is being restarted.
 *   - `conflict`: the finished execution has not released its slot yet.
 *
 * Open Agents runs tools sequentially per sandbox, so a `conflict` here is
 * never a genuine concurrent caller. Both resolve on their own, so both are
 * waited out rather than surfaced to the model as a failed tool call.
 */
function isTransientExecConflict(err: unknown): boolean {
  if (!(err instanceof BrokerApiError) || err.status !== 409) return false;
  if (err.code === "conflict") return true;
  return err.code === "sandbox_error" && /\bis starting\b/.test(err.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consume the exec stream.
 *
 * stdout and stderr get their own streaming `TextDecoder` so a multi-byte
 * character split across two frames is not mangled into replacement chars.
 */
async function streamExec(input: {
  client: BrokerClientLike;
  sandboxId: string;
  command: string;
  cwd: string;
  timeoutMs: number;
  batcher: OutputBatcher;
  signal?: AbortSignal;
  /** Budget for waiting out a post-cancellation restart. */
  restartWaitMs?: number;
}): Promise<StreamOutcome> {
  const decoders: Record<SandboxCommandStream, TextDecoder> = {
    stdout: new TextDecoder("utf-8"),
    stderr: new TextDecoder("utf-8"),
  };

  let result: Extract<ExecEvent, { type: "result" }> | null = null;
  let errorFrame: StreamOutcome["errorFrame"] = null;

  /** Flush whatever a trailing partial multi-byte sequence left behind. */
  const drain = (): { stdout: string; stderr: string } => {
    for (const stream of ["stdout", "stderr"] as const) {
      const tail = decoders[stream].decode();
      if (tail) input.batcher.onChunk(stream, tail);
    }
    return input.batcher.finish();
  };

  /**
   * Open the stream, waiting out the sandbox's post-cancellation recovery.
   * This is what makes "the next command still works" true after a timeout or
   * an abort.
   */
  const openStream = async (): Promise<AsyncIterable<ExecEvent>> => {
    const request = {
      command: input.command,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
    };
    const options = input.signal ? { signal: input.signal } : {};
    const budgetMs = input.restartWaitMs ?? DEFAULT_RESTART_WAIT_MS;
    const deadline = Date.now() + budgetMs;

    for (;;) {
      try {
        return await input.client.exec(input.sandboxId, request, options);
      } catch (err) {
        if (!isTransientExecConflict(err)) throw err;
        if (Date.now() >= deadline) {
          throw new AgentBackendError(
            `Broker sandbox ${input.sandboxId} did not become ready for the next command within ${Math.round(budgetMs / 1_000)}s: ${(err as BrokerApiError).message}`,
            { cause: err },
          );
        }
        await delay(RESTART_POLL_MS);
      }
    }
  };

  try {
    const events = await openStream();

    for await (const event of events) {
      switch (event.type) {
        case "stdout":
        case "stderr": {
          const text = decoders[event.type].decode(decodeBase64(event.dataBase64), {
            stream: true,
          });
          if (text) input.batcher.onChunk(event.type, text);
          break;
        }
        case "result":
          result = event;
          break;
        case "error":
          errorFrame = { code: event.code, message: event.message };
          break;
      }
    }
  } catch (err) {
    // An abort cancels the command broker-side, but it also tears down the
    // response body, so the terminal `result` frame never arrives. That is a
    // cancelled execution, not a transport failure — report it as one and
    // keep whatever output made it through.
    if (!input.signal?.aborted) throw err;
    const partial = drain();
    return {
      ...partial,
      exitCode: EXEC_CANCELLED_EXIT_CODE,
      timedOut: false,
      cancelled: true,
      errorFrame: null,
    };
  }

  const { stdout, stderr } = drain();
  if (errorFrame) {
    return { stdout, stderr, exitCode: 1, timedOut: false, cancelled: false, errorFrame };
  }
  if (!result) {
    throw new AgentBackendError(
      "Broker exec stream ended without a terminal result frame",
    );
  }
  return {
    stdout,
    stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
    errorFrame: null,
  };
}

function annotate(outcome: StreamOutcome, timeoutSeconds: number): string {
  if (outcome.errorFrame) {
    return `broker error (${outcome.errorFrame.code}): ${outcome.errorFrame.message}`;
  }
  if (outcome.timedOut) return `command timed out after ${timeoutSeconds}s`;
  if (outcome.cancelled) return "command cancelled";
  return "";
}

export type RunBrokerCommandInput = {
  client: BrokerClientLike;
  sandboxId: string;
  command: string;
  cwd: string;
  workspaceDir: string;
  timeoutSeconds?: number;
  policy?: SandboxPolicyBundle;
  onOutput?: (chunk: SandboxCommandOutputChunk) => void;
  signal?: AbortSignal;
  restartWaitMs?: number;
};

/**
 * Run a model-issued command. The shell guardrails run *before* the broker is
 * contacted, with internal-network protection forced on
 * (see {@link brokerEnforcedNetworkPolicy}).
 */
export async function runBrokerCommand(
  input: RunBrokerCommandInput,
): Promise<SandboxExecResult> {
  const verdict = checkShellCommand(input.command, {
    network: brokerEnforcedNetworkPolicy(input.policy?.network),
    command: input.policy?.command,
  });
  if (!verdict.allowed) return blockedCommandResult(verdict.reason);

  const limits = resolveCommandPolicy(input.policy?.command);
  const timeoutSeconds = clampTimeout(input.timeoutSeconds, input.policy?.command);
  const batcher = createOutputBatcher(input.onOutput);

  let outcome: StreamOutcome;
  try {
    outcome = await streamExec({
      client: input.client,
      sandboxId: input.sandboxId,
      command: input.command,
      cwd: input.cwd || input.workspaceDir,
      timeoutMs: Math.min(timeoutSeconds * 1_000, MAX_EXEC_TIMEOUT_MS),
      batcher,
      signal: input.signal,
      restartWaitMs: input.restartWaitMs,
    });
  } catch (err) {
    throw wrapBrokerError(err, `Failed to run command in sandbox ${input.sandboxId}`);
  }

  const note = annotate(outcome, timeoutSeconds);
  return finalizeCommandResult({
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: note ? [outcome.stderr, note].filter(Boolean).join("\n") : outcome.stderr,
    maxOutputChars: limits.maxOutputChars,
  });
}

/**
 * Run an adapter-internal command (`mkdir -p`, `find`).
 *
 * These are plumbing the Daytona adapter performs through dedicated SDK
 * endpoints, so they deliberately bypass the agent's deny rules: an admin
 * regex meant for model-issued shell commands must not break `makeDir`.
 */
export async function runInternalCommand(input: {
  client: BrokerClientLike;
  sandboxId: string;
  command: string;
  cwd: string;
  timeoutSeconds: number;
  context: string;
  restartWaitMs?: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const outcome = await streamExec({
      client: input.client,
      sandboxId: input.sandboxId,
      command: input.command,
      cwd: input.cwd,
      timeoutMs: Math.min(input.timeoutSeconds * 1_000, MAX_EXEC_TIMEOUT_MS),
      batcher: createOutputBatcher(),
      restartWaitMs: input.restartWaitMs,
    });
    if (outcome.errorFrame) {
      throw new AgentBackendError(
        `${input.context}: broker error (${outcome.errorFrame.code}): ${outcome.errorFrame.message}`,
      );
    }
    return {
      exitCode: outcome.exitCode,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
    };
  } catch (err) {
    throw wrapBrokerError(err, input.context);
  }
}
