import {
  BrokerApiError,
  BrokerExecError,
  BrokerRequestError,
  BrokerResponseError,
  BrokerStreamError,
} from "@sandbox-broker/client";
import { AgentBackendError } from "../../agent-backend/types.js";

/**
 * Map broker client failures onto `AgentBackendError`, the single error type
 * jobs and routes handle.
 *
 * The client builds its messages from the response envelope only — never from
 * request headers — so nothing here can carry the bearer token.
 */
export function wrapBrokerError(err: unknown, context: string): AgentBackendError {
  if (err instanceof AgentBackendError) return err;

  if (err instanceof BrokerApiError) {
    return new AgentBackendError(
      `${context}: ${err.message} (${err.code}, HTTP ${err.status})`,
      { cause: err },
    );
  }
  if (err instanceof BrokerStreamError) {
    return new AgentBackendError(
      `${context}: broker stream protocol violation (${err.reason}): ${err.message}`,
      { cause: err },
    );
  }
  if (err instanceof BrokerResponseError) {
    return new AgentBackendError(
      `${context}: broker response did not match the pinned v1 contract: ${err.message}`,
      { cause: err },
    );
  }
  if (err instanceof BrokerRequestError || err instanceof BrokerExecError) {
    return new AgentBackendError(`${context}: ${err.message}`, { cause: err });
  }
  if (err instanceof Error) {
    return new AgentBackendError(`${context}: ${err.message}`, { cause: err });
  }
  return new AgentBackendError(`${context}: ${String(err)}`, { cause: err });
}

/** Short, log/UI-safe description of why the broker is unusable. */
export function describeBrokerFailure(err: unknown): string {
  if (err instanceof BrokerApiError) return `${err.message} (${err.code})`;
  if (err instanceof Error) return err.message;
  return String(err);
}
