import { config } from "../config.js";
import { log } from "../log.js";
import { createBrokerSandboxProvider } from "./broker/index.js";
import { resolveBrokerConfig } from "./broker/config.js";
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
  broker: async () => {
    // A deployment with no `SANDBOX_BROKER_URL` resolves to `null` silently.
    // A URL with a broken credential throws, because that is a
    // misconfiguration an operator needs to see rather than a missing option.
    const brokerConfig = await resolveBrokerConfig(config);
    if (!brokerConfig) return null;
    log.info("sandbox-provider: broker configured", { baseUrl: brokerConfig.baseUrl });
    return createBrokerSandboxProvider(brokerConfig);
  },
});

/** Drop cached provider instances after a credential or selection change. */
export function resetSandboxProviders(id?: SandboxProviderId): void {
  sandboxProviderRegistry.reset(id);
}
