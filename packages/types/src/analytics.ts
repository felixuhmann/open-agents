import { z } from "zod";

export const AnalyticsSurface = z.enum(["chat", "email", "workflow"]);
export type AnalyticsSurface = z.infer<typeof AnalyticsSurface>;

export const AnalyticsWindowPreset = z.enum(["30d", "12m", "custom"]);
export type AnalyticsWindowPreset = z.infer<typeof AnalyticsWindowPreset>;

export const AnalyticsGranularity = z.enum(["day", "month"]);
export type AnalyticsGranularity = z.infer<typeof AnalyticsGranularity>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .describe("Inclusive UTC calendar date (YYYY-MM-DD)");

export const AnalyticsQuery = z
  .object({
    window: z
      .enum(["30d", "12m"])
      .optional()
      .describe("Preset time window (default: 12m)"),
    from: isoDate.optional().describe("Custom range start (UTC date, inclusive)"),
    to: isoDate.optional().describe("Custom range end (UTC date, inclusive)"),
  })
  .superRefine((value, ctx) => {
    const hasFrom = Boolean(value.from);
    const hasTo = Boolean(value.to);
    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: "custom",
        message: "Both from and to are required for a custom date range",
        path: hasFrom ? ["to"] : ["from"],
      });
      return;
    }
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: "custom",
        message: "from must be on or before to",
        path: ["from"],
      });
    }
  });
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export const AnalyticsMetricRow = z.object({
  runs: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  errorRate: z.number().min(0).max(1),
  avgDurationMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  spendUsd: z.number().nonnegative(),
});
export type AnalyticsMetricRow = z.infer<typeof AnalyticsMetricRow>;

export const AnalyticsAgentRow = AnalyticsMetricRow.extend({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  bySurface: z.array(AnalyticsMetricRow.extend({ surface: AnalyticsSurface })),
});
export type AnalyticsAgentRow = z.infer<typeof AnalyticsAgentRow>;

export const AnalyticsSummary = z.object({
  generatedAt: z.string().datetime(),
  window: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    preset: AnalyticsWindowPreset,
    granularity: AnalyticsGranularity,
    periods: z.number().int().positive(),
  }),
  totals: AnalyticsMetricRow,
  periods: z.array(AnalyticsMetricRow.extend({ period: z.string() })),
  agents: z.array(AnalyticsAgentRow),
  models: z.array(AnalyticsMetricRow.extend({ model: z.string() })),
  providers: z.array(AnalyticsMetricRow.extend({ provider: z.string() })),
  surfaces: z.array(AnalyticsMetricRow.extend({ surface: AnalyticsSurface })),
  notes: z.array(z.string()),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummary>;
