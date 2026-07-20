import { SandboxApiException, SandboxException } from "@alibaba-group/opensandbox";
import { AgentBackendError } from "./types.js";

/**
 * Map OpenSandbox SDK failures to `AgentBackendError` so jobs and routes see a
 * single backend error type while preserving the original cause for logs.
 */
export function wrapOpenSandboxError(err: unknown, context: string): AgentBackendError {
  if (err instanceof AgentBackendError) {
    return err;
  }
  if (err instanceof SandboxApiException) {
    const suffix = err.statusCode !== undefined ? ` (HTTP ${err.statusCode})` : "";
    return new AgentBackendError(`${context}: ${err.message}${suffix}`, { cause: err });
  }
  if (err instanceof SandboxException) {
    return new AgentBackendError(`${context}: ${err.message}`, { cause: err });
  }
  if (err instanceof Error) {
    return new AgentBackendError(`${context}: ${err.message}`, { cause: err });
  }
  return new AgentBackendError(`${context}: ${String(err)}`, { cause: err });
}
