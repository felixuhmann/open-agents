import { sandboxProviderRegistry } from "../sandbox-provider/instance.js";
import { getActiveSandboxProviderId } from "../services/sandboxProviderSettingsInstance.js";
import type { SandboxProviderId } from "../sandbox-provider/types.js";
import { createAgentBackendResolver } from "./backendResolver.js";
import { PiAgentBackend } from "./pi.js";
import type { AgentBackend } from "./types.js";

/**
 * Lazy AgentBackend factory. The runtime itself is provider-neutral, but it
 * can only run once the deployment's active sandbox provider is configured
 * (Daytona's API key lives in the encrypted Secret store). Callers go through
 * `getAgentBackend()` and get an actionable error if setup hasn't run.
 *
 * The instance is cached per active provider and rebuilt after a selection or
 * credential change (`resetAgentBackend()`).
 */

function missingProviderMessage(id: SandboxProviderId): string {
  if (id === "daytona") {
    return "Daytona API key is not configured. Complete setup at /setup.";
  }
  return `Sandbox provider "${id}" is not configured. Complete setup at /setup.`;
}

const resolver = createAgentBackendResolver<AgentBackend>({
  loadCredentialKey: async () => {
    const providerId = await getActiveSandboxProviderId();
    const provider = await sandboxProviderRegistry.tryGet(providerId);
    return provider ? providerId : null;
  },
  build: () =>
    new PiAgentBackend({
      registry: sandboxProviderRegistry,
      activeProviderId: getActiveSandboxProviderId,
    }),
  missingCredentialMessage: "",
});

export async function getAgentBackend(): Promise<AgentBackend> {
  const providerId = await getActiveSandboxProviderId();
  const provider = await sandboxProviderRegistry.tryGet(providerId);
  if (!provider) {
    throw new Error(missingProviderMessage(providerId));
  }
  return resolver.get();
}

/** Force the next `getAgentBackend()` call to rebuild the singleton. */
export function resetAgentBackend(): void {
  resolver.reset();
  sandboxProviderRegistry.reset();
}
