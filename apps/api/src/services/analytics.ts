import type {
  AnalyticsAgentRow,
  AnalyticsGranularity,
  AnalyticsMetricRow,
  AnalyticsQuery,
  AnalyticsSummary,
  AnalyticsSurface,
  AnalyticsWindowPreset,
} from "@open-agents/types";
import { prisma } from "../db.js";
import { estimateModelSpendUsd, type TokenUsage } from "./analyticsPricing.js";

type UsagePayload = {
  type: "model.request";
  model?: string | null;
  provider?: string | null;
  usage: TokenUsage;
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

type AgentAccumulator = Accumulator & {
  id: string;
  slug: string;
  displayName: string;
  bySurface: Map<string, Accumulator>;
};

type ResolvedWindow = {
  from: Date;
  to: Date;
  preset: AnalyticsWindowPreset;
  granularity: AnalyticsGranularity;
  periodKeys: string[];
};

const MAX_CUSTOM_RANGE_DAYS = 366;

export async function buildAnalyticsSummary(
  query: AnalyticsQuery,
  now = new Date(),
): Promise<AnalyticsSummary> {
  const resolved = resolveAnalyticsWindow(query, now);
  const { from: startDate, to: endDate, preset, granularity, periodKeys } = resolved;

  const runs = await prisma.agentRun.findMany({
    where: {
      startedAt: {
        gte: startDate,
        lte: endDate,
      },
    },
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
          modelProvider: true,
          modelId: true,
        },
      },
      events: {
        where: { type: "model.request" },
        select: { payload: true },
      },
    },
  });

  const totals = emptyAccumulator();
  const byPeriod = new Map(periodKeys.map((key) => [key, emptyAccumulator()]));
  const byAgent = new Map<string, AgentAccumulator>();
  const byModel = new Map<string, Accumulator & { model: string }>();
  const byProvider = new Map<string, Accumulator & { provider: string }>();
  const bySurface = new Map<string, Accumulator & { surface: string }>();

  for (const run of runs) {
    const durationMs =
      run.completedAt && run.completedAt.getTime() >= run.startedAt.getTime()
        ? run.completedAt.getTime() - run.startedAt.getTime()
        : null;
    const failed = run.status === "failed";
    const periodKey = toPeriodKey(run.startedAt, granularity);
    const period = byPeriod.get(periodKey);
    const agent = getOrCreateAgent(byAgent, run.agent);
    const agentSurface = getOrCreate(agent.bySurface, run.surface, emptyAccumulator);
    const surface = getOrCreate(bySurface, run.surface, () => ({
      ...emptyAccumulator(),
      surface: run.surface,
    }));

    addRun(totals, durationMs, failed);
    if (period) addRun(period, durationMs, failed);
    addRun(agent, durationMs, failed);
    addRun(agentSurface, durationMs, failed);
    addRun(surface, durationMs, failed);

    for (const event of run.events) {
      const payload = parseUsagePayload(event.payload);
      if (!payload) continue;

      const agentModelRef = `${run.agent.modelProvider}/${run.agent.modelId}`;
      const model = payload.model ?? agentModelRef;
      const provider = payload.provider ?? run.agent.modelProvider;
      const modelRow = getOrCreate(byModel, model, () => ({
        ...emptyAccumulator(),
        model,
      }));
      const providerRow = getOrCreate(byProvider, provider, () => ({
        ...emptyAccumulator(),
        provider,
      }));
      const spendUsd = estimateModelSpendUsd(model, payload.usage);

      addUsage(totals, payload.usage, spendUsd);
      if (period) addUsage(period, payload.usage, spendUsd);
      addUsage(agent, payload.usage, spendUsd);
      addUsage(agentSurface, payload.usage, spendUsd);
      addUsage(surface, payload.usage, spendUsd);
      addUsage(modelRow, payload.usage, spendUsd);
      addUsage(providerRow, payload.usage, spendUsd);
    }
  }

  return {
    generatedAt: now.toISOString(),
    window: {
      from: startDate.toISOString(),
      to: endDate.toISOString(),
      preset,
      granularity,
      periods: periodKeys.length,
    },
    totals: serializeAccumulator(totals),
    periods: periodKeys.map((period) => ({
      period,
      ...serializeAccumulator(byPeriod.get(period) ?? emptyAccumulator()),
    })),
    agents: [...byAgent.values()]
      .map(serializeAgentRow)
      .sort((a, b) => b.spendUsd - a.spendUsd),
    models: [...byModel.values()]
      .map((row) => ({ model: row.model, ...serializeAccumulator(row) }))
      .sort((a, b) => b.spendUsd - a.spendUsd),
    providers: [...byProvider.values()]
      .map((row) => ({ provider: row.provider, ...serializeAccumulator(row) }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    surfaces: [...bySurface.values()]
      .map((row) => ({
        surface: row.surface as AnalyticsSurface,
        ...serializeAccumulator(row),
      }))
      .sort((a, b) => b.runs - a.runs),
    notes: [
      "Token usage is aggregated from durable model.request RunEvents emitted by Daytona/Pi.",
      "Spend is estimated from pi-ai catalog model ids plus family-level price heuristics; unknown models report spendUsd as 0 while tokens still count.",
      "Provider is taken from the event payload when present, otherwise inferred from the agent configuration.",
      "Workflow activity appears under the workflow surface and as per-agent step runs; pipeline-level WorkflowRun metrics are not included.",
    ],
  };
}

export function resolveAnalyticsWindow(query: AnalyticsQuery, now: Date): ResolvedWindow {
  if (query.from && query.to) {
    const from = startOfUtcDay(parseIsoDate(query.from));
    const to = endOfUtcDay(parseIsoDate(query.to));
    const rangeDays = inclusiveUtcDayCount(from, to);
    if (rangeDays > MAX_CUSTOM_RANGE_DAYS) {
      throw new AnalyticsRangeError(
        `Custom date range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`,
      );
    }
    const granularity: AnalyticsGranularity = rangeDays <= 31 ? "day" : "month";
    const periodKeys =
      granularity === "day" ? buildDayKeys(from, to) : buildMonthKeys(from, to);
    return { from, to, preset: "custom", granularity, periodKeys };
  }

  const preset: AnalyticsWindowPreset = query.window === "30d" ? "30d" : "12m";
  if (preset === "30d") {
    const from = startOfUtcDay(addUtcDays(now, -29));
    const to = endOfUtcDay(now);
    return {
      from,
      to,
      preset,
      granularity: "day",
      periodKeys: buildDayKeys(from, to),
    };
  }

  const monthKeys = buildMonthKeysForLastMonths(now, 12);
  const from = startOfUtcMonth(parseYearMonth(monthKeys[0]!));
  const to = endOfUtcDay(now);
  return {
    from,
    to,
    preset,
    granularity: "month",
    periodKeys: monthKeys,
  };
}

export class AnalyticsRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsRangeError";
  }
}

function serializeAgentRow(agent: AgentAccumulator): AnalyticsAgentRow {
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    ...serializeAccumulator(agent),
    bySurface: [...agent.bySurface.entries()]
      .map(([surface, acc]) => ({
        surface: surface as AnalyticsSurface,
        ...serializeAccumulator(acc),
      }))
      .sort((a, b) => b.runs - a.runs),
  };
}

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

function addUsage(acc: Accumulator, usage: TokenUsage, spendUsd: number): void {
  acc.inputTokens += usage.inputTokens;
  acc.outputTokens += usage.outputTokens;
  acc.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  acc.cacheReadInputTokens += usage.cacheReadInputTokens;
  acc.spendUsd += spendUsd;
}

function serializeAccumulator(acc: Accumulator): AnalyticsMetricRow {
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
    provider: typeof record.provider === "string" ? record.provider : null,
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

function getOrCreateAgent(
  map: Map<string, AgentAccumulator>,
  agent: { id: string; slug: string; displayName: string },
): AgentAccumulator {
  const existing = map.get(agent.id);
  if (existing) return existing;
  const next: AgentAccumulator = {
    ...emptyAccumulator(),
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    bySurface: new Map(),
  };
  map.set(agent.id, next);
  return next;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing) return existing;
  const next = create();
  map.set(key, next);
  return next;
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function inclusiveUtcDayCount(from: Date, to: Date): number {
  const start = startOfUtcDay(from).getTime();
  const end = startOfUtcDay(to).getTime();
  return Math.floor((end - start) / 86_400_000) + 1;
}

function buildMonthKeysForLastMonths(now: Date, count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  cursor.setUTCMonth(cursor.getUTCMonth() - count + 1);
  for (let i = 0; i < count; i += 1) {
    keys.push(toMonthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function buildMonthKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = startOfUtcMonth(from);
  const end = startOfUtcMonth(to);
  while (cursor.getTime() <= end.getTime()) {
    keys.push(toMonthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function buildDayKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  while (cursor.getTime() <= end.getTime()) {
    keys.push(toDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function parseYearMonth(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, 1));
}

function toPeriodKey(date: Date, granularity: AnalyticsGranularity): string {
  return granularity === "day" ? toDayKey(date) : toMonthKey(date);
}

function toDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}
