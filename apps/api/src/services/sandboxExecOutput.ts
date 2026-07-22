import type { SandboxCommandPolicy } from "@open-agents/types";
import type {
  SandboxCommandOutputChunk,
  SandboxCommandStream,
  SandboxExecResult,
} from "../sandbox-provider/types.js";
import {
  DEFAULT_BASH_TIMEOUT_SECONDS,
  TOOL_OUTPUT_EMIT_INTERVAL_MS,
  TOOL_OUTPUT_EMIT_MIN_CHARS,
  truncateText,
} from "./sandboxLimits.js";

/**
 * Provider-neutral command-output plumbing.
 *
 * Timeout clamping, incremental streaming, and model-facing truncation must
 * behave identically no matter which sandbox provider produced the bytes, so
 * every adapter shares this module rather than reimplementing it.
 */

export type ResolvedCommandLimits = Required<
  Pick<
    SandboxCommandPolicy,
    "maxRuntimeSeconds" | "maxOutputChars" | "maxBackgroundProcessLifetimeSeconds"
  >
>;

export function resolveCommandPolicy(
  policy?: SandboxCommandPolicy,
): ResolvedCommandLimits {
  return {
    maxRuntimeSeconds: policy?.maxRuntimeSeconds ?? DEFAULT_BASH_TIMEOUT_SECONDS,
    maxOutputChars: policy?.maxOutputChars ?? 20_000,
    maxBackgroundProcessLifetimeSeconds:
      policy?.maxBackgroundProcessLifetimeSeconds ?? 600,
  };
}

/** Clamp a caller-requested timeout into the agent's command policy. */
export function clampTimeout(
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

export type OutputBatcher = {
  onChunk(stream: SandboxCommandStream, chunk: string): void;
  finish(): { stdout: string; stderr: string };
};

/**
 * Buffer the full output while forwarding it to the caller in coarse batches,
 * so a chatty command does not emit one `tool.output` RunEvent per byte.
 */
export function createOutputBatcher(
  onOutput?: (chunk: SandboxCommandOutputChunk) => void,
): OutputBatcher {
  let stdoutBuf = "";
  let stderrBuf = "";
  let lastEmitAt = 0;
  let stdoutPending = "";
  let stderrPending = "";

  const flush = (stream: SandboxCommandStream, pending: string): string => {
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
    onChunk(stream: SandboxCommandStream, chunk: string) {
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

/** Apply the agent's output ceiling to a finished command. */
export function finalizeCommandResult(input: {
  exitCode: number;
  stdout: string;
  stderr: string;
  maxOutputChars: number;
}): SandboxExecResult {
  const { exitCode, stdout, stderr, maxOutputChars } = input;
  const combined = [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : "");
  const truncatedStdout = truncateText(stdout, maxOutputChars, "stdout");
  const truncatedStderr = truncateText(stderr, maxOutputChars, "stderr");
  const truncatedCombined = truncateText(
    combined || `(exit ${exitCode})`,
    maxOutputChars,
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

/** The result shape a provider returns when the shell policy refused. */
export function blockedCommandResult(reason: string): SandboxExecResult {
  const message = `policy blocked: ${reason}`;
  return {
    exitCode: 1,
    stdout: "",
    stderr: message,
    combined: message,
    truncated: false,
    policyBlocked: reason,
  };
}
