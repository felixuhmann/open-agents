import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";
import { AnthropicAgentBackend } from "./anthropic.js";
import type { AgentBackend } from "./types.js";

/**
 * Lazy AgentBackend factory. The Anthropic API key now lives in the
 * encrypted Secret store, so the backend can only be constructed *after*
 * the first-run wizard has populated it. Callers go through `getAgentBackend()`
 * and get an error if the deployment isn't configured yet.
 *
 * The underlying SDK client is stateless apart from `apiKey`/`baseURL`, so
 * a single instance is safe to share. We rebuild the instance whenever
 * `resetAgentBackend()` is called (e.g. after a credential rotation).
 */

let cached: AgentBackend | null = null;
let cachedApiKey: string | null = null;
let cachedVaultId: string | null = null;

export async function getAgentBackend(): Promise<AgentBackend> {
  const apiKey = await getServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY);
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is not configured. Complete the setup wizard at /setup.",
    );
  }
  const vaultId = (await getServiceSecret(SERVICE_KEYS.ANTHROPIC_VAULT_ID)) ?? null;

  if (cached && cachedApiKey === apiKey && cachedVaultId === vaultId) {
    return cached;
  }

  cached = new AnthropicAgentBackend(
    new Anthropic({ apiKey, baseURL: config.ANTHROPIC_BASE_URL }),
    vaultId ? [vaultId] : [],
  );
  cachedApiKey = apiKey;
  cachedVaultId = vaultId;
  return cached;
}

/** Force the next `getAgentBackend()` call to rebuild the singleton. */
export function resetAgentBackend(): void {
  cached = null;
  cachedApiKey = null;
  cachedVaultId = null;
}

/**
 * Convenience for code paths that want a raw Anthropic SDK client (e.g.
 * the agent provisioning service that calls `client.beta.agents.create`).
 */
export async function getAnthropicClient(): Promise<Anthropic> {
  const apiKey = await getServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY);
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is not configured. Complete the setup wizard at /setup.",
    );
  }
  return new Anthropic({ apiKey, baseURL: config.ANTHROPIC_BASE_URL });
}
