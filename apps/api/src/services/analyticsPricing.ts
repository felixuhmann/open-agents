import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";

export type ModelPriceUsdPerMillion = { input: number; output: number };

/** Canonical USD / 1M tokens for major model families. */
const FAMILY_PRICES: Array<{ pattern: RegExp; price: ModelPriceUsdPerMillion }> = [
  { pattern: /opus-4-7|opus-4\.7/i, price: { input: 5, output: 25 } },
  { pattern: /opus-4-6|opus-4\.6/i, price: { input: 5, output: 25 } },
  { pattern: /opus-4-5|opus-4\.5|opus-4-1|opus-4\.1/i, price: { input: 15, output: 75 } },
  { pattern: /opus-4(?!-)|opus-4-0|opus-4-2025/i, price: { input: 15, output: 75 } },
  { pattern: /opus-3|claude-3-opus/i, price: { input: 15, output: 75 } },
  { pattern: /sonnet-4-6|sonnet-4\.6/i, price: { input: 3, output: 15 } },
  { pattern: /sonnet-4-5|sonnet-4\.5/i, price: { input: 3, output: 15 } },
  { pattern: /sonnet-4(?!-)|sonnet-4-0|sonnet-4-2025/i, price: { input: 3, output: 15 } },
  {
    pattern: /sonnet-3-7|sonnet-3\.7|3-5-sonnet|3\.5-sonnet|claude-3-5-sonnet/i,
    price: { input: 3, output: 15 },
  },
  { pattern: /sonnet-3|claude-3-sonnet/i, price: { input: 3, output: 15 } },
  { pattern: /haiku-4-5|haiku-4\.5/i, price: { input: 1, output: 5 } },
  {
    pattern: /haiku-3-5|haiku-3\.5|3-5-haiku|3\.5-haiku|claude-3-5-haiku/i,
    price: { input: 0.8, output: 4 },
  },
  { pattern: /haiku-3|claude-3-haiku/i, price: { input: 0.25, output: 1.25 } },
  { pattern: /^o3-pro/i, price: { input: 20, output: 80 } },
  { pattern: /^o3-mini/i, price: { input: 1.1, output: 4.4 } },
  { pattern: /^o3(?!-)/i, price: { input: 2, output: 8 } },
  { pattern: /^o4-mini/i, price: { input: 1.1, output: 4.4 } },
  { pattern: /^o1-pro/i, price: { input: 15, output: 60 } },
  { pattern: /^o1-mini/i, price: { input: 1.1, output: 4.4 } },
  { pattern: /^o1(?!-)/i, price: { input: 15, output: 60 } },
  { pattern: /gpt-4\.1-mini/i, price: { input: 0.4, output: 1.6 } },
  { pattern: /gpt-4\.1-nano/i, price: { input: 0.1, output: 0.4 } },
  { pattern: /gpt-4\.1/i, price: { input: 2, output: 8 } },
  { pattern: /gpt-4o-mini/i, price: { input: 0.15, output: 0.6 } },
  { pattern: /gpt-4o/i, price: { input: 2.5, output: 10 } },
  { pattern: /gpt-4-turbo/i, price: { input: 10, output: 30 } },
  { pattern: /gpt-4(?!o)/i, price: { input: 30, output: 60 } },
  { pattern: /gpt-3\.5-turbo/i, price: { input: 0.5, output: 1.5 } },
  { pattern: /gemini-2\.5-pro/i, price: { input: 1.25, output: 10 } },
  { pattern: /gemini-2\.5-flash-lite/i, price: { input: 0.1, output: 0.4 } },
  { pattern: /gemini-2\.5-flash/i, price: { input: 0.3, output: 2.5 } },
  { pattern: /gemini-2\.0-flash-lite/i, price: { input: 0.075, output: 0.3 } },
  { pattern: /gemini-2\.0-flash/i, price: { input: 0.1, output: 0.4 } },
  { pattern: /gemini-1\.5-pro/i, price: { input: 1.25, output: 5 } },
  { pattern: /gemini-1\.5-flash/i, price: { input: 0.075, output: 0.3 } },
  { pattern: /deepseek-r1|deepseek-reasoner/i, price: { input: 0.55, output: 2.19 } },
  { pattern: /deepseek-v3|deepseek-chat/i, price: { input: 0.27, output: 1.1 } },
  { pattern: /llama-3\.3-70b|llama-3\.1-70b/i, price: { input: 0.59, output: 0.79 } },
  { pattern: /llama-3\.1-8b|llama-3\.2-3b/i, price: { input: 0.05, output: 0.08 } },
  { pattern: /mistral-large/i, price: { input: 2, output: 6 } },
  { pattern: /mistral-small/i, price: { input: 0.2, output: 0.6 } },
  { pattern: /mixtral-8x7b/i, price: { input: 0.24, output: 0.24 } },
  { pattern: /grok-3-mini/i, price: { input: 0.3, output: 0.5 } },
  { pattern: /grok-3/i, price: { input: 3, output: 15 } },
  { pattern: /grok-2/i, price: { input: 2, output: 10 } },
];

const EXPLICIT_PRICES: Record<string, ModelPriceUsdPerMillion> = {
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

let catalogPriceById: Map<string, ModelPriceUsdPerMillion> | null = null;

function normalizeModelKey(model: string): string {
  let key = model.trim().toLowerCase();
  key = key.replace(/^[^:]+[/:]/, "");
  key = key.replace(/^~/, "");
  key = key.replace(/^(global|us|eu|au|jp)\./, "");
  key = key.replace(/^anthropic\./, "");
  key = key.replace(/-v\d+:\d+$/i, "");
  key = key.replace(/-\d{8}$/i, "");
  key = key.replace(/\./g, "-");
  return key;
}

function resolveFamilyPrice(normalized: string): ModelPriceUsdPerMillion | null {
  for (const { pattern, price } of FAMILY_PRICES) {
    if (pattern.test(normalized)) return price;
  }
  return null;
}

function buildCatalogPriceIndex(): Map<string, ModelPriceUsdPerMillion> {
  const index = new Map<string, ModelPriceUsdPerMillion>();
  for (const providerId of getBuiltinProviders()) {
    for (const model of getBuiltinModels(providerId)) {
      const normalized = normalizeModelKey(model.id);
      const price =
        EXPLICIT_PRICES[model.id] ??
        EXPLICIT_PRICES[normalized] ??
        resolveFamilyPrice(normalized) ??
        resolveFamilyPrice(model.id);
      if (price) {
        index.set(model.id, price);
        index.set(normalized, price);
      }
    }
  }
  for (const [modelId, price] of Object.entries(EXPLICIT_PRICES)) {
    index.set(modelId, price);
    index.set(normalizeModelKey(modelId), price);
  }
  return index;
}

function getCatalogPriceIndex(): Map<string, ModelPriceUsdPerMillion> {
  catalogPriceById ??= buildCatalogPriceIndex();
  return catalogPriceById;
}

export function lookupModelPrice(model: string): ModelPriceUsdPerMillion | null {
  const index = getCatalogPriceIndex();
  const direct = index.get(model) ?? index.get(normalizeModelKey(model));
  if (direct) return direct;
  const normalized = normalizeModelKey(model);
  return resolveFamilyPrice(normalized) ?? resolveFamilyPrice(model);
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export function estimateModelSpendUsd(model: string, usage: TokenUsage): number {
  const price = lookupModelPrice(model);
  if (!price) return 0;
  const billableInputTokens =
    usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  return (
    (billableInputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output
  );
}
