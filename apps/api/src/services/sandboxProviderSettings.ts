import type {
  SandboxProviderInfoDto,
  SandboxProviderStatusDto,
} from "@open-agents/types";
import { AgentBackendError } from "../agent-backend/types.js";
import type { SandboxProviderRegistry } from "../sandbox-provider/registry.js";
import { sandboxProviderFromSessionId } from "../sandbox-provider/sessionId.js";
import {
  isSandboxProviderId,
  SANDBOX_PROVIDER_IDS,
  type SandboxProviderId,
} from "../sandbox-provider/types.js";
import { log } from "../log.js";

/**
 * Deployment-wide sandbox provider selection.
 *
 * Exactly one provider is active for *new* sandboxes. Existing sandbox rows
 * and session ids always dispatch through their own recorded provider, so
 * switching never breaks history — it just means the next use of a session
 * on the old provider gets a fresh sandbox.
 *
 * Storage and provider construction are injected so the rules can be
 * exercised without a database or credentials.
 */

/** Provider assumed when no setting has ever been written. */
export const DEFAULT_SANDBOX_PROVIDER: SandboxProviderId = "daytona";

/**
 * Interpret the stored `sandbox_provider` value.
 *
 * An absent value means this deployment predates the setting, so it keeps
 * running on Daytona. An unrecognized value (hand-edited row, downgrade)
 * also falls back rather than taking the deployment down.
 */
export function parseActiveSandboxProviderId(
  raw: string | null | undefined,
): SandboxProviderId {
  if (!raw) return DEFAULT_SANDBOX_PROVIDER;
  if (isSandboxProviderId(raw)) return raw;
  log.warn("sandbox-provider: unrecognized stored selection, using default", {
    stored: raw,
    fallback: DEFAULT_SANDBOX_PROVIDER,
  });
  return DEFAULT_SANDBOX_PROVIDER;
}

/**
 * Whether a stored session belongs to a different provider than the active
 * one, in which case it must not be resumed. An absent or unparseable
 * session id is not a mismatch — those paths already create a new session.
 */
export function isSessionProviderMismatch(
  sessionId: string | null | undefined,
  activeProviderId: SandboxProviderId,
): boolean {
  const provider = sandboxProviderFromSessionId(sessionId);
  if (!provider) return false;
  return provider !== activeProviderId;
}

export type SandboxProviderSettingsDeps = {
  registry: SandboxProviderRegistry;
  readSetting: () => Promise<string | null>;
  writeSetting: (value: string) => Promise<void>;
  /** Invoked after a successful selection so cached instances are rebuilt. */
  onChange?: () => void;
};

export type SandboxProviderSettings = {
  getActiveProviderId(): Promise<SandboxProviderId>;
  describe(): Promise<SandboxProviderStatusDto>;
  select(id: SandboxProviderId): Promise<SandboxProviderStatusDto>;
};

export function createSandboxProviderSettings(
  deps: SandboxProviderSettingsDeps,
): SandboxProviderSettings {
  async function getActiveProviderId(): Promise<SandboxProviderId> {
    return parseActiveSandboxProviderId(await deps.readSetting());
  }

  async function inspect(id: SandboxProviderId): Promise<SandboxProviderInfoDto> {
    const provider = await deps.registry.tryGet(id);
    if (!provider) {
      return {
        id,
        available: false,
        detail: `Sandbox provider "${id}" is not configured for this deployment.`,
        capabilities: null,
      };
    }
    const health = await provider.health();
    return {
      id,
      available: health.available,
      detail: health.detail ?? null,
      capabilities: {
        networkModes: [...provider.capabilities.networkModes],
        archive: provider.capabilities.archive,
        recover: provider.capabilities.recover,
      },
    };
  }

  async function describeWith(active: SandboxProviderId) {
    const providers: SandboxProviderInfoDto[] = [];
    for (const id of SANDBOX_PROVIDER_IDS) {
      providers.push(await inspect(id));
    }
    const warnings: string[] = [];
    const activeInfo = providers.find((p) => p.id === active);
    if (!activeInfo?.available) {
      warnings.push(
        `The active sandbox provider "${active}" is unavailable${
          activeInfo?.detail ? `: ${activeInfo.detail}` : "."
        } New sandboxes cannot be created until it is configured and reachable.`,
      );
    }
    return { active, providers, warnings } satisfies SandboxProviderStatusDto;
  }

  return {
    getActiveProviderId,

    async describe(): Promise<SandboxProviderStatusDto> {
      return describeWith(await getActiveProviderId());
    },

    /**
     * Health-check the target *before* persisting. If it is unusable the
     * setting is left exactly as it was.
     */
    async select(id: SandboxProviderId): Promise<SandboxProviderStatusDto> {
      const info = await inspect(id);
      if (!info.available) {
        throw new AgentBackendError(
          `Cannot select sandbox provider "${id}"${
            info.detail ? `: ${info.detail}` : "."
          } The current selection is unchanged.`,
        );
      }

      const current = await getActiveProviderId();
      if (current !== id) {
        await deps.writeSetting(id);
        deps.onChange?.();
        log.info("sandbox-provider: active provider changed", {
          from: current,
          to: id,
        });
      }
      return describeWith(id);
    },
  };
}
