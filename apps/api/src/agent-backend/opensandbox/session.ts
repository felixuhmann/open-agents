import { AgentBackendError } from "../types.js";

/** Provider identifier persisted on `AgentSandbox` rows and run events. */
export const OPENSANDBOX_PROVIDER = "opensandbox";

/** Prefix for backend session ids: `opensandbox:{agentId}:{sandboxId}`. */
export const OPENSANDBOX_SESSION_PREFIX = "opensandbox";

/**
 * Deterministic working directory inside every OpenSandbox guest. We own the
 * guest image (WORKDIR `/workspace`), so unlike the previous provider there is
 * no per-image discovery step — the workspace is always `/workspace`.
 */
export const SANDBOX_WORKSPACE_DIR = "/workspace";

export type OpenSandboxSessionRef = {
  agentId: string;
  sandboxId: string;
};

export function buildOpenSandboxSessionId(agentId: string, sandboxId: string): string {
  return `${OPENSANDBOX_SESSION_PREFIX}:${agentId}:${sandboxId}`;
}

export function isOpenSandboxSessionId(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  const [prefix, agentId, sandboxId] = sessionId.split(":");
  return prefix === OPENSANDBOX_SESSION_PREFIX && Boolean(agentId) && Boolean(sandboxId);
}

export function parseOpenSandboxSessionId(sessionId: string): OpenSandboxSessionRef {
  const [prefix, agentId, sandboxId] = sessionId.split(":");
  if (prefix !== OPENSANDBOX_SESSION_PREFIX || !agentId || !sandboxId) {
    throw new AgentBackendError(`Invalid OpenSandbox session id: ${sessionId}`);
  }
  return { agentId, sandboxId };
}

/**
 * Canonical sandbox state we mirror onto `AgentSandbox.state`. Admin lifecycle
 * controls and the reconcile worker branch on these values, so the mapping from
 * the provider's lifecycle vocabulary is explicit and total.
 */
export type CanonicalSandboxState =
  | "creating"
  | "starting"
  | "started"
  | "stopping"
  | "stopped"
  | "deleting"
  | "deleted"
  | "error"
  | "unknown";

/**
 * Map an OpenSandbox lifecycle state (`SandboxInfo.status.state`) to our
 * canonical state. `Running` is our "started"; `Paused` is our "stopped"
 * (OpenSandbox has no separate stop state — pause is the stop primitive).
 */
export function mapOpenSandboxState(
  state: string | null | undefined,
): CanonicalSandboxState {
  switch (state) {
    case "Creating":
      return "creating";
    case "Resuming":
      return "starting";
    case "Running":
      return "started";
    case "Pausing":
      return "stopping";
    case "Paused":
      return "stopped";
    case "Deleting":
      return "deleting";
    case "Deleted":
      return "deleted";
    case "Error":
      return "error";
    default:
      return "unknown";
  }
}
