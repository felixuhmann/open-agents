import { AgentBackendError } from "../agent-backend/types.js";
import { log } from "../log.js";
import type { SandboxProvider, SandboxProviderId } from "./types.js";

/**
 * Provider registry.
 *
 * A factory returns `null` when its provider is registered but not
 * configured for this deployment (no credential, no broker URL). Factories
 * are injected so lifecycle dispatch can be exercised without credentials or
 * a database.
 */
export type SandboxProviderFactory = () => Promise<SandboxProvider | null>;

export type SandboxProviderFactories = Partial<
  Record<SandboxProviderId, SandboxProviderFactory>
>;

export type SandboxProviderRegistry = {
  /** Resolve a provider or throw when unregistered/unconfigured/failing. */
  get(id: SandboxProviderId): Promise<SandboxProvider>;
  /** Resolve a provider, or `null` for any of those same reasons. */
  tryGet(id: SandboxProviderId): Promise<SandboxProvider | null>;
  /** Every provider that currently resolves, skipping the rest. */
  listConfigured(): Promise<SandboxProvider[]>;
  registeredIds(): SandboxProviderId[];
  /** Drop cached instances after a credential or selection change. */
  reset(id?: SandboxProviderId): void;
};

export function createSandboxProviderRegistry(
  factories: SandboxProviderFactories,
): SandboxProviderRegistry {
  const cache = new Map<SandboxProviderId, SandboxProvider>();
  const ids = Object.keys(factories) as SandboxProviderId[];

  async function build(id: SandboxProviderId): Promise<SandboxProvider> {
    const cached = cache.get(id);
    if (cached) return cached;

    const factory = factories[id];
    if (!factory) {
      throw new AgentBackendError(`Unknown sandbox provider: ${id}`);
    }
    const provider = await factory();
    if (!provider) {
      // Not cached: configuring it later must take effect without a reset.
      throw new AgentBackendError(
        `Sandbox provider "${id}" is not configured for this deployment.`,
      );
    }
    cache.set(id, provider);
    return provider;
  }

  return {
    get: build,
    async tryGet(id: SandboxProviderId): Promise<SandboxProvider | null> {
      try {
        return await build(id);
      } catch (err) {
        log.debug("sandbox-provider: unavailable", { provider: id, err: String(err) });
        return null;
      }
    },
    async listConfigured(): Promise<SandboxProvider[]> {
      const out: SandboxProvider[] = [];
      for (const id of ids) {
        const provider = await this.tryGet(id);
        if (provider) out.push(provider);
      }
      return out;
    },
    registeredIds(): SandboxProviderId[] {
      return [...ids];
    },
    reset(id?: SandboxProviderId): void {
      if (id) cache.delete(id);
      else cache.clear();
    },
  };
}
