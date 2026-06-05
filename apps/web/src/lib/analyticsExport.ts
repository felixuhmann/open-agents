import type {
  AnalyticsAgentRow,
  AnalyticsMetricRow,
  AnalyticsSummary,
} from "@open-agents/types";

type CsvSection = {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
};

export function buildAnalyticsCsv(
  data: AnalyticsSummary,
  options?: { surfaceFilter?: "all" | "chat" | "email" | "workflow" },
): string {
  const surfaceFilter = options?.surfaceFilter ?? "all";
  const sections: CsvSection[] = [
    {
      title: "Summary",
      headers: metricHeaders(),
      rows: [metricValues(data.totals)],
    },
    {
      title: "Periods",
      headers: ["period", ...metricHeaders()],
      rows: data.periods.map((row) => [row.period, ...metricValues(row)]),
    },
    {
      title: "Surfaces",
      headers: ["surface", ...metricHeaders()],
      rows: data.surfaces.map((row) => [row.surface, ...metricValues(row)]),
    },
    {
      title: "Providers",
      headers: ["provider", ...metricHeaders()],
      rows: data.providers.map((row) => [row.provider, ...metricValues(row)]),
    },
    {
      title: "Models",
      headers: ["model", ...metricHeaders()],
      rows: data.models.map((row) => [row.model, ...metricValues(row)]),
    },
    {
      title: surfaceFilter === "all" ? "Agents" : `Agents (${surfaceFilter} surface)`,
      headers: ["displayName", "slug", "surfaces", ...metricHeaders()],
      rows: buildAgentRows(data.agents, surfaceFilter),
    },
  ];

  return sections
    .map((section) => {
      const lines = [
        section.title,
        section.headers.map(escapeCsv).join(","),
        ...section.rows.map((row) => row.map(escapeCsv).join(",")),
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

export function downloadAnalyticsCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildAgentRows(
  agents: AnalyticsAgentRow[],
  surfaceFilter: "all" | "chat" | "email" | "workflow",
): Array<Array<string | number>> {
  return agents
    .map((agent) => {
      const metrics = resolveAgentMetrics(agent, surfaceFilter);
      if (surfaceFilter !== "all" && metrics.runs === 0) return null;
      return [
        agent.displayName,
        agent.slug,
        agent.bySurface
          .filter((row) => row.runs > 0)
          .map((row) => row.surface)
          .join("|"),
        ...metricValues(metrics),
      ];
    })
    .filter((row): row is Array<string | number> => row !== null);
}

function resolveAgentMetrics(
  agent: AnalyticsAgentRow,
  surfaceFilter: "all" | "chat" | "email" | "workflow",
): AnalyticsMetricRow {
  if (surfaceFilter === "all") {
    return agent;
  }
  const surface = agent.bySurface.find((row) => row.surface === surfaceFilter);
  return (
    surface ?? {
      runs: 0,
      failedRuns: 0,
      errorRate: 0,
      avgDurationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      spendUsd: 0,
    }
  );
}

function metricHeaders(): string[] {
  return [
    "runs",
    "failedRuns",
    "errorRate",
    "avgDurationMs",
    "inputTokens",
    "outputTokens",
    "cacheCreationInputTokens",
    "cacheReadInputTokens",
    "totalTokens",
    "spendUsd",
  ];
}

function metricValues(row: AnalyticsMetricRow): Array<string | number> {
  return [
    row.runs,
    row.failedRuns,
    row.errorRate,
    row.avgDurationMs,
    row.inputTokens,
    row.outputTokens,
    row.cacheCreationInputTokens,
    row.cacheReadInputTokens,
    row.totalTokens,
    row.spendUsd,
  ];
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
