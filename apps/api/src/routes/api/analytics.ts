import { Hono } from "hono";
import { requireAgentOperator } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";

export const analyticsRoutes = new Hono<{ Variables: AppVariables }>();

const MODEL_PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

type UsagePayload = {
  type: "model.request";
  model?: string | null;
  isError?: boolean;
  usage: Usage;
};

type Accumulator = {
  runs: number;
  failedRuns: number;
  completedRuns: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  spendUsd: number;
};

analyticsRoutes.get("/", async (c) => {
  requireAgentOperator(c);

  const now = new Date();
  const monthKeys = buildMonthKeys(now, 12);
  const startDate = new Date(`${monthKeys[0]}-01T00:00:00.000Z`);

  const runs = await prisma.agentRun.findMany({
    where: { startedAt: { gte: startDate } },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      surface: true,
      status: true,
      startedAt: true,
      completedAt: true,
      agent: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          model: true,
        },
      },
      events: {
        where: { type: "model.request" },
        select: { payload: true },
      },
    },
  });

  const totals = emptyAccumulator();
  const byMonth = new Map(monthKeys.map((key) => [key, emptyAccumulator()]));
  const byAgent = new Map<
    string,
    Accumulator & { id: string; slug: string; displayName: string }
  >();
  const byModel = new Map<string, Accumulator & { model: string }>();
  const bySurface = new Map<string, Accumulator & { surface: string }>();

  for (const run of runs) {
    const durationMs =
      run.completedAt && run.completedAt.getTime() >= run.startedAt.getTime()
        ? run.completedAt.getTime() - run.startedAt.getTime()
        : null;
    const failed = run.status === "failed";
    const monthKey = toMonthKey(run.startedAt);
    const month = byMonth.get(monthKey);
    const agent = getOrCreate(byAgent, run.agent.id, () => ({
      ...emptyAccumulator(),
      id: run.agent.id,
      slug: run.agent.slug,
      displayName: run.agent.displayName,
    }));
    const surface = getOrCreate(bySurface, run.surface, () => ({
      ...emptyAccumulator(),
      surface: run.surface,
    }));

    addRun(totals, durationMs, failed);
    if (month) addRun(month, durationMs, failed);
    addRun(agent, durationMs, failed);
    addRun(surface, durationMs, failed);

    for (const event of run.events) {
      const payload = parseUsagePayload(event.payload);
      if (!payload) continue;

      const model = payload.model ?? run.agent.model ?? "unknown";
      const modelRow = getOrCreate(byModel, model, () => ({
        ...emptyAccumulator(),
        model,
      }));
      const spendUsd = estimateSpendUsd(model, payload.usage);

      addUsage(totals, payload.usage, spendUsd);
      if (month) addUsage(month, payload.usage, spendUsd);
      addUsage(agent, payload.usage, spendUsd);
      addUsage(surface, payload.usage, spendUsd);
      addUsage(modelRow, payload.usage, spendUsd);
    }
  }

  return c.json({
    generatedAt: now.toISOString(),
    window: {
      from: startDate.toISOString(),
      to: now.toISOString(),
      months: monthKeys.length,
    },
    totals: serializeAccumulator(totals),
    monthly: monthKeys.map((month) => ({
      month,
      ...serializeAccumulator(byMonth.get(month) ?? emptyAccumulator()),
    })),
    agents: [...byAgent.values()]
      .map((row) => ({ ...pickIdentity(row), ...serializeAccumulator(row) }))
      .sort((a, b) => b.spendUsd - a.spendUsd),
    models: [...byModel.values()]
      .map((row) => ({ model: row.model, ...serializeAccumulator(row) }))
      .sort((a, b) => b.spendUsd - a.spendUsd),
    surfaces: [...bySurface.values()]
      .map((row) => ({ surface: row.surface, ...serializeAccumulator(row) }))
      .sort((a, b) => b.runs - a.runs),
    notes: [
      "Token usage comes from Managed Agents span.model_request_end events captured after analytics instrumentation is deployed.",
      "Spend is estimated from the configured model price table and excludes provider-side billing adjustments not present in stream events.",
    ],
  });
});

function emptyAccumulator(): Accumulator {
  return {
    runs: 0,
    failedRuns: 0,
    completedRuns: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    spendUsd: 0,
  };
}

function addRun(acc: Accumulator, durationMs: number | null, failed: boolean): void {
  acc.runs += 1;
  if (failed) acc.failedRuns += 1;
  if (durationMs !== null) {
    acc.completedRuns += 1;
    acc.durationMs += durationMs;
  }
}

function addUsage(acc: Accumulator, usage: Usage, spendUsd: number): void {
  acc.inputTokens += usage.inputTokens;
  acc.outputTokens += usage.outputTokens;
  acc.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  acc.cacheReadInputTokens += usage.cacheReadInputTokens;
  acc.spendUsd += spendUsd;
}

function serializeAccumulator(acc: Accumulator) {
  const totalTokens =
    acc.inputTokens +
    acc.outputTokens +
    acc.cacheCreationInputTokens +
    acc.cacheReadInputTokens;
  return {
    runs: acc.runs,
    failedRuns: acc.failedRuns,
    errorRate: acc.runs > 0 ? acc.failedRuns / acc.runs : 0,
    avgDurationMs:
      acc.completedRuns > 0 ? Math.round(acc.durationMs / acc.completedRuns) : 0,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheCreationInputTokens: acc.cacheCreationInputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens,
    totalTokens,
    spendUsd: roundMoney(acc.spendUsd),
  };
}

function estimateSpendUsd(model: string, usage: Usage): number {
  const price = MODEL_PRICES_USD_PER_MILLION[model];
  if (!price) return 0;
  const billableInputTokens =
    usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  return (
    (billableInputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output
  );
}

function parseUsagePayload(payload: unknown): UsagePayload | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.type !== "model.request") return null;
  const usage = record.usage;
  if (!usage || typeof usage !== "object") return null;
  const usageRecord = usage as Record<string, unknown>;
  return {
    type: "model.request",
    model: typeof record.model === "string" ? record.model : null,
    isError: typeof record.isError === "boolean" ? record.isError : undefined,
    usage: {
      inputTokens: readNumber(usageRecord.inputTokens),
      outputTokens: readNumber(usageRecord.outputTokens),
      cacheCreationInputTokens: readNumber(usageRecord.cacheCreationInputTokens),
      cacheReadInputTokens: readNumber(usageRecord.cacheReadInputTokens),
    },
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function buildMonthKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  cursor.setUTCMonth(cursor.getUTCMonth() - count + 1);
  for (let i = 0; i < count; i += 1) {
    keys.push(toMonthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing) return existing;
  const next = create();
  map.set(key, next);
  return next;
}

function pickIdentity(row: { id: string; slug: string; displayName: string }) {
  return { id: row.id, slug: row.slug, displayName: row.displayName };
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}
