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
  /**
   * Why the last `tryGet` for this provider failed, or `null` when it
   * succeeded or the provider is simply unconfigured. Lets Settings say
   * "token file is empty" instead of "not configured".
   */
  lastFailure(id: SandboxProviderId): string | null;
  registeredIds(): SandboxProviderId[];
  /** Drop cached instances after a credential or selection change. */
  reset(id?: SandboxProviderId): void;
};

export function createSandboxProviderRegistry(
  factories: SandboxProviderFactories,
): SandboxProviderRegistry {
  const cache = new Map<SandboxProviderId, SandboxProvider>();
  const failures = new Map<SandboxProviderId, string>();
  const ids = Object.keys(factories) as SandboxProviderId[];

  /** Distinguishes "no such option here" from "configured, but broken". */
  const UNCONFIGURED = Symbol("unconfigured");

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
      const unconfigured = new AgentBackendError(
        `Sandbox provider "${id}" is not configured for this deployment.`,
      );
      Object.defineProperty(unconfigured, UNCONFIGURED, { value: true });
      throw unconfigured;
    }
    cache.set(id, provider);
    failures.delete(id);
    return provider;
  }

  return {
    get: build,
    async tryGet(id: SandboxProviderId): Promise<SandboxProvider | null> {
      try {
        return await build(id);
      } catch (err) {
        log.debug("sandbox-provider: unavailable", { provider: id, err: String(err) });
        if (err && typeof err === "object" && UNCONFIGURED in err) {
          failures.delete(id);
        } else {
          failures.set(id, err instanceof Error ? err.message : String(err));
        }
        return null;
      }
    },
    lastFailure(id: SandboxProviderId): string | null {
      return failures.get(id) ?? null;
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
