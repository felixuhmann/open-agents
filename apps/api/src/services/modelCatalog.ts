import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import type { ModelCatalogDto } from "@open-agents/types";
import { getServiceSecret } from "../secrets/service.js";
import {
  CREDENTIAL_PROVIDERS,
  isCredentialProvider,
  providerSecretKey,
} from "./piModel.js";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Google",
  "google-vertex": "Google Vertex",
  groq: "Groq",
  xai: "xAI",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  cerebras: "Cerebras",
  together: "Together AI",
  fireworks: "Fireworks",
  bedrock: "Amazon Bedrock",
};

function providerLabel(id: string): string {
  return (
    PROVIDER_LABELS[id] ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Providers shown first in the agent editor (credential-backed). */
const PROVIDER_ORDER = new Map<string, number>(
  CREDENTIAL_PROVIDERS.map((id, index) => [id, index]),
);

/**
 * Build the model catalog for the SPA from pi-ai's generated registry.
 * Only lists providers that have at least one tool-calling model.
 */
export async function buildModelCatalog(): Promise<ModelCatalogDto> {
  const providerIds = getBuiltinProviders().sort((a, b) => {
    const ao = PROVIDER_ORDER.get(a) ?? 100;
    const bo = PROVIDER_ORDER.get(b) ?? 100;
    if (ao !== bo) return ao - bo;
    return providerLabel(a).localeCompare(providerLabel(b));
  });

  const providers = await Promise.all(
    providerIds.map(async (id) => {
      const credentialSupported = isCredentialProvider(id);
      const secretKey = providerSecretKey(id);
      const configured = secretKey ? Boolean(await getServiceSecret(secretKey)) : false;
      const models = getBuiltinModels(id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          api: m.api,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          reasoning: m.reasoning,
          inputModalities: m.input,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        id,
        label: providerLabel(id),
        credentialSupported,
        configured,
        models,
      };
    }),
  );

  return { providers: providers.filter((p) => p.models.length > 0) };
}
