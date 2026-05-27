import { DaytonaError } from "@daytona/sdk";
import { AgentBackendError } from "./types.js";

/**
 * Map Daytona SDK failures to `AgentBackendError` so jobs and routes see a
 * single backend error type while preserving the original cause for logs.
 */
export function wrapDaytonaError(err: unknown, context: string): AgentBackendError {
  if (err instanceof AgentBackendError) {
    return err;
  }
  if (err instanceof DaytonaError) {
    const suffix = err.statusCode !== undefined ? ` (HTTP ${err.statusCode})` : "";
    return new AgentBackendError(`${context}: ${err.message}${suffix}`, {
      cause: err,
    });
  }
  if (err instanceof Error) {
    return new AgentBackendError(`${context}: ${err.message}`, { cause: err });
  }
  return new AgentBackendError(`${context}: ${String(err)}`, { cause: err });
}
