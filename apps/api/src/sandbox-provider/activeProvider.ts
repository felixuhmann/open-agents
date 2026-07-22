import { AgentBackendError } from "../agent-backend/types.js";
import type { SandboxProviderRegistry } from "./registry.js";
import type { SandboxProvider, SandboxProviderId } from "./types.js";

/**
 * Resolve the provider a *new* sandbox must be created on.
 *
 * This is the only place the deployment-wide selection is allowed to gate
 * anything. Connecting to, streaming from, mounting into, or managing an
 * *existing* sandbox always goes through that session's own recorded
 * provider (`PiAgentBackend.withHandle`, `sandboxLifecycle`), so a switch —
 * or an outage on the newly selected provider — never strands sessions that
 * were created on a provider which is still configured and healthy.
 *
 * Failing here is an operator-actionable state, not a server fault, so the
 * error carries a 503 and says what to fix.
 */
export async function resolveProviderForNewSandbox(
  registry: SandboxProviderRegistry,
  activeProviderId: SandboxProviderId,
): Promise<SandboxProvider> {
  const provider = await registry.tryGet(activeProviderId);
  if (provider) return provider;

  const failure = registry.lastFailure(activeProviderId);
  throw new AgentBackendError(unavailableMessage(activeProviderId, failure), {
    status: 503,
  });
}

function unavailableMessage(id: SandboxProviderId, failure: string | null): string {
  const cause =
    failure ??
    (id === "daytona"
      ? "Daytona API key is not configured."
      : `Sandbox provider "${id}" is not configured for this deployment.`);
  return `Cannot create a sandbox: the active sandbox provider "${id}" is unavailable. ${cause} Complete setup at /setup or select a different provider in Settings.`;
}
