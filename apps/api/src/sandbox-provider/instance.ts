import { createDaytonaSandboxProvider } from "./daytona/index.js";
import { createSandboxProviderRegistry } from "./registry.js";
import type { SandboxProviderId } from "./types.js";
import { getDaytonaApiKey } from "../services/daytonaSandbox.js";

/**
 * Deployment-wide provider registry.
 *
 * Factories read their own credentials and return `null` when the provider
 * isn't configured, so an unconfigured provider never blocks the configured
 * one (reconciliation in particular must keep going).
 */
export const sandboxProviderRegistry = createSandboxProviderRegistry({
  daytona: async () => {
    const apiKey = await getDaytonaApiKey();
    if (!apiKey) return null;
    return createDaytonaSandboxProvider(apiKey);
  },
});

/** Drop cached provider instances after a credential or selection change. */
export function resetSandboxProviders(id?: SandboxProviderId): void {
  sandboxProviderRegistry.reset(id);
}
