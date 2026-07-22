import { sandboxProviderRegistry } from "../sandbox-provider/instance.js";
import { getActiveSandboxProviderId } from "../services/sandboxProviderSettingsInstance.js";
import { PiAgentBackend } from "./pi.js";
import type { AgentBackend } from "./types.js";

/**
 * Lazy AgentBackend singleton.
 *
 * The runtime is provider-neutral and stateless with respect to the
 * deployment's provider selection: every operation on an *existing* session
 * dispatches through the provider recorded in that session's id, and only
 * `createSession()` consults the active provider. Getting the backend
 * therefore must not require the active provider to resolve — otherwise a
 * broker outage would stop in-flight and historical Daytona sessions from
 * streaming, mounting, or being managed, even though Daytona is still
 * configured and healthy.
 *
 * Provider instances and their credentials are cached in the registry, which
 * `resetAgentBackend()` clears after setup or a selection change.
 */

let cached: AgentBackend | null = null;

// eslint-disable-next-line @typescript-eslint/require-await
export async function getAgentBackend(): Promise<AgentBackend> {
  cached ??= new PiAgentBackend({
    registry: sandboxProviderRegistry,
    activeProviderId: getActiveSandboxProviderId,
  });
  return cached;
}

/** Drop cached provider instances after a credential or selection change. */
export function resetAgentBackend(): void {
  cached = null;
  sandboxProviderRegistry.reset();
}
