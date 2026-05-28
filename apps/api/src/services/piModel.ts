import {
  getModels,
  getProviders,
  type Api,
  type KnownProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { AgentBackendError } from "../agent-backend/types.js";
import { getServiceSecret, SERVICE_KEYS, type ServiceKey } from "../secrets/service.js";

/** Providers we expose in Settings and resolve via encrypted service secrets. */
export const CREDENTIAL_PROVIDERS = ["anthropic", "openai", "openrouter"] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

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
  const providers = getProviders();
  if (!providers.includes(modelProvider as KnownProvider)) {
    throw new AgentBackendError(`Unknown model provider: ${modelProvider}`);
  }
  const models = getModels(modelProvider as KnownProvider);
  const found = models.find((m) => m.id === modelId);
  if (!found) {
    throw new AgentBackendError(`Unknown model ${modelProvider}/${modelId}`);
  }
  return found;
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
