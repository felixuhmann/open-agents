import { AgentBackendError } from "../agent-backend/types.js";
import { isSandboxProviderId, type SandboxProviderId } from "./types.js";

/**
 * Session id codec shared by every provider.
 *
 * Every id this deployment has ever persisted is
 * `daytona:{agentId}:{providerSandboxId}`, so the generic format is
 * deliberately identical: `{provider}:{agentId}:{providerSandboxId}`.
 * Existing rows keep parsing and Daytona keeps emitting the exact same
 * string — the only change is that the provider is now returned explicitly
 * instead of being assumed.
 */

export type SandboxSessionRef = {
  provider: SandboxProviderId;
  agentId: string;
  providerSandboxId: string;
};

/** Components may not be empty, contain the separator, or carry whitespace. */
const COMPONENT = /^[^\s:]+$/;

export function buildSandboxSessionId(
  provider: SandboxProviderId,
  agentId: string,
  providerSandboxId: string,
): string {
  if (!isSandboxProviderId(provider)) {
    throw new AgentBackendError(`Unknown sandbox provider: ${String(provider)}`);
  }
  if (!COMPONENT.test(agentId)) {
    throw new AgentBackendError(`Invalid agent id for sandbox session: ${agentId}`);
  }
  if (!COMPONENT.test(providerSandboxId)) {
    throw new AgentBackendError(
      `Invalid provider sandbox id for sandbox session: ${providerSandboxId}`,
    );
  }
  return `${provider}:${agentId}:${providerSandboxId}`;
}

export function parseSandboxSessionId(sessionId: string): SandboxSessionRef {
  const ref = tryParseSandboxSessionId(sessionId);
  if (!ref) {
    throw new AgentBackendError(`Invalid sandbox session id: ${sessionId}`);
  }
  return ref;
}

export function tryParseSandboxSessionId(
  sessionId: string | null | undefined,
): SandboxSessionRef | null {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const parts = sessionId.split(":");
  if (parts.length !== 3) return null;
  const [provider, agentId = "", providerSandboxId = ""] = parts;
  if (!isSandboxProviderId(provider)) return null;
  if (!COMPONENT.test(agentId)) return null;
  if (!COMPONENT.test(providerSandboxId)) return null;
  return { provider, agentId, providerSandboxId };
}

/** Provider recorded in a session id, or `null` when it is unusable. */
export function sandboxProviderFromSessionId(
  sessionId: string | null | undefined,
): SandboxProviderId | null {
  return tryParseSandboxSessionId(sessionId)?.provider ?? null;
}
