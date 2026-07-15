import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import {
  getBuiltinModels,
  getBuiltinProviders,
  type BuiltinProvider,
} from "@earendil-works/pi-ai/providers/all";
import type { ReasoningLevel } from "@open-agents/types";
import { AgentBackendError } from "../agent-backend/types.js";
import { getServiceSecret, SERVICE_KEYS, type ServiceKey } from "../secrets/service.js";

/** Providers we expose in Settings and resolve via encrypted service secrets. */
export const CREDENTIAL_PROVIDERS = ["anthropic", "openai", "openrouter"] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

const REASONING_LEVEL_ORDER: readonly ReasoningLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const OPENAI_GPT_56_MODEL = /^gpt-5\.6-(?:luna|sol|terra)$/;

const PROVIDER_SECRET_KEYS: Record<CredentialProvider, ServiceKey> = {
  anthropic: SERVICE_KEYS.ANTHROPIC_API_KEY,
  openai: SERVICE_KEYS.OPENAI_API_KEY,
  openrouter: SERVICE_KEYS.OPENROUTER_API_KEY,
};

export function isCredentialProvider(provider: string): provider is CredentialProvider {
  return (CREDENTIAL_PROVIDERS as readonly string[]).includes(provider);
}

export function providerSecretKey(provider: string): ServiceKey | undefined {
  if (!isCredentialProvider(provider)) return undefined;
  return PROVIDER_SECRET_KEYS[provider];
}

/**
 * Resolve a Pi `Model` for the agent loop. Validates provider + id against
 * the built-in pi-ai catalog.
 */
export function resolvePiModel(modelProvider: string, modelId: string): Model<Api> {
  const providers = getBuiltinProviders();
  if (!providers.includes(modelProvider as BuiltinProvider)) {
    throw new AgentBackendError(`Unknown model provider: ${modelProvider}`);
  }
  const models = getBuiltinModels(modelProvider as BuiltinProvider);
  const found = models.find((m) => m.id === modelId);
  if (!found) {
    throw new AgentBackendError(`Unknown model ${modelProvider}/${modelId}`);
  }
  return found;
}

/**
 * Return the selectable Pi reasoning levels for a model.
 *
 * Pi 0.80.7 leaves `minimal` implicitly enabled for GPT-5.6, while the
 * provider accepts none/low/medium/high/xhigh/max. Keep that invalid request
 * out of both the API catalog and persisted agent configuration.
 */
export function supportedReasoningLevelsForModel(model: Model<Api>): ReasoningLevel[] {
  const levels = getSupportedThinkingLevels(model);
  if (model.provider === "openai" && OPENAI_GPT_56_MODEL.test(model.id)) {
    return levels.filter((level) => level !== "minimal");
  }
  return levels;
}

/** Match Pi's nearest-supported fallback using the filtered application catalog. */
export function normalizeReasoningLevelForModel(
  model: Model<Api>,
  requested: ReasoningLevel,
): ReasoningLevel {
  const supported = supportedReasoningLevelsForModel(model);
  if (supported.includes(requested)) return requested;

  const requestedIndex = REASONING_LEVEL_ORDER.indexOf(requested);
  for (let i = requestedIndex; i < REASONING_LEVEL_ORDER.length; i += 1) {
    const candidate = REASONING_LEVEL_ORDER[i];
    if (candidate && supported.includes(candidate)) return candidate;
  }
  for (let i = requestedIndex - 1; i >= 0; i -= 1) {
    const candidate = REASONING_LEVEL_ORDER[i];
    if (candidate && supported.includes(candidate)) return candidate;
  }
  return "off";
}

/**
 * `getApiKey` callback for pi-agent-core: reads deployment secrets for
 * supported providers.
 */
export async function resolvePiProviderApiKey(
  provider: string,
): Promise<string | undefined> {
  const secretKey = providerSecretKey(provider);
  if (!secretKey) return undefined;
  return (await getServiceSecret(secretKey)) ?? undefined;
}

export function formatModelRef(modelProvider: string, modelId: string): string {
  return `${modelProvider}/${modelId}`;
}
