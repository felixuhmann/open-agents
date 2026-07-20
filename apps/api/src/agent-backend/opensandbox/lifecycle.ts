import type { CanonicalSandboxState } from "./session.js";

export type ConnectAction = "connect" | "resume" | "error";

/**
 * Decide how to obtain an execd connection to an existing sandbox given its
 * current lifecycle state: connect directly when running, resume when paused,
 * and refuse for terminal/transient states.
 */
export function planConnectAction(state: CanonicalSandboxState): ConnectAction {
  if (state === "started" || state === "starting" || state === "creating")
    return "connect";
  if (state === "stopped") return "resume";
  return "error";
}

export type ReconcileAction = "clear" | "pause" | "none";

/**
 * Decide the reconcile action for one tracked sandbox. `clear` drops dead
 * session pointers (provider no longer has it); `pause` stops a running sandbox
 * that is stale or an expired orphan; `none` leaves it untouched.
 */
export function planReconcileAction(input: {
  state: CanonicalSandboxState;
  isOrphan: boolean;
  isStale: boolean;
  orphanExpired: boolean;
}): ReconcileAction {
  if (input.state === "deleted") return "clear";
  if (
    input.state === "started" &&
    (input.isStale || (input.isOrphan && input.orphanExpired))
  ) {
    return "pause";
  }
  return "none";
}
