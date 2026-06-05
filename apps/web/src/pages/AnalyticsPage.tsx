import type {
  AnalyticsAgentRow,
  AnalyticsMetricRow,
  AnalyticsSurface,
} from "@open-agents/types";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import {
  ActivityIcon,
  ClockIcon,
  CoinsIcon,
  DownloadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader, SectionHeading } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildAnalyticsCsv, downloadAnalyticsCsv } from "@/lib/analyticsExport";
import { useAnalyticsRange, type AnalyticsRange } from "@/lib/queries";

const spendChartConfig = {
  spendUsd: { label: "Spend", color: "var(--chart-2)" },
} satisfies ChartConfig;

const tokenChartConfig = {
  inputTokens: { label: "Input", color: "var(--chart-2)" },
  outputTokens: { label: "Output", color: "var(--chart-4)" },
  cacheReadInputTokens: { label: "Cache read", color: "var(--chart-1)" },
} satisfies ChartConfig;

const agentChartConfig = {
  spendUsd: { label: "Spend", color: "var(--chart-3)" },
} satisfies ChartConfig;

const modelChartConfig = {
  totalTokens: { label: "Tokens", color: "var(--chart-4)" },
} satisfies ChartConfig;

const providerChartConfig = {
  totalTokens: { label: "Tokens", color: "var(--chart-5)" },
} satisfies ChartConfig;

const surfaceChartConfig = {
  chat: { label: "Chat", color: "var(--chart-1)" },
  email: { label: "Email", color: "var(--chart-2)" },
  workflow: { label: "Workflow", color: "var(--chart-3)" },
} satisfies ChartConfig;

const SURFACE_COLORS: Record<AnalyticsSurface, string> = {
  chat: "var(--color-chat)",
  email: "var(--color-email)",
  workflow: "var(--color-workflow)",
};

type SurfaceFilter = "all" | AnalyticsSurface;

export default function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>({ preset: "12m" });
  const [customDraft, setCustomDraft] = useState(defaultCustomRange);
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("all");
  const analytics = useAnalyticsRange(range);
  const data = analytics.data;
  const isDaily = data?.window.granularity === "day";

  const filteredAgents = useMemo(() => {
    if (!data) return [];
    return data.agents
      .map((agent) => ({
        agent,
        metrics: resolveAgentMetrics(agent, surfaceFilter),
      }))
      .filter(({ metrics }) => surfaceFilter === "all" || metrics.runs > 0)
      .sort((a, b) => b.metrics.spendUsd - a.metrics.spendUsd);
  }, [data, surfaceFilter]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        description="Usage, cost, reliability, and latency across every agent surface."
        meta={
          data
            ? `${formatDate(data.window.from)} - ${formatDate(data.window.to)}`
            : range.preset === "custom"
              ? "Custom range"
              : range.preset === "30d"
                ? "Last 30 days"
                : "Last 12 months"
        }
        actions={
          <div className="flex flex-wrap items-end justify-end gap-3">
            {data ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const filename = `analytics-${data.window.from.slice(0, 10)}-${data.window.to.slice(0, 10)}.csv`;
                  downloadAnalyticsCsv(
                    filename,
                    buildAnalyticsCsv(data, { surfaceFilter }),
                  );
                }}
              >
                <DownloadSimpleIcon />
                Export CSV
              </Button>
            ) : null}
            <Tabs
              value={range.preset}
              onValueChange={(value) => {
                if (value === "30d" || value === "12m") {
                  setRange({ preset: value });
                  return;
                }
                if (value === "custom") {
                  setRange({ preset: "custom", ...customDraft });
                }
              }}
            >
              <TabsList aria-label="Analytics time frame">
                <TabsTrigger value="30d">30 days</TabsTrigger>
                <TabsTrigger value="12m">12 months</TabsTrigger>
                <TabsTrigger value="custom">Custom</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        }
      />

      {range.preset === "custom" ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 pt-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="analytics-from">From</Label>
              <Input
                id="analytics-from"
                type="date"
                value={customDraft.from}
                max={customDraft.to}
                onChange={(event) => {
                  const next = { ...customDraft, from: event.target.value };
                  setCustomDraft(next);
                  if (next.from && next.to) {
                    setRange({ preset: "custom", ...next });
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="analytics-to">To</Label>
              <Input
                id="analytics-to"
                type="date"
                value={customDraft.to}
                min={customDraft.from}
                max={toIsoDate(new Date())}
                onChange={(event) => {
                  const next = { ...customDraft, to: event.target.value };
                  setCustomDraft(next);
                  if (next.from && next.to) {
                    setRange({ preset: "custom", ...next });
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {analytics.isLoading ? (
        <AnalyticsSkeleton />
      ) : data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Estimated spend"
              value={formatMoney(data.totals.spendUsd)}
              description={formatTokens(data.totals.totalTokens)}
              icon={CoinsIcon}
            />
            <MetricCard
              title="Runs"
              value={data.totals.runs.toLocaleString()}
              description={`${data.totals.failedRuns.toLocaleString()} failed`}
              icon={ActivityIcon}
            />
            <MetricCard
              title="Error rate"
              value={formatPercent(data.totals.errorRate)}
              description="Failed runs / total runs"
              icon={WarningCircleIcon}
            />
            <MetricCard
              title="Average time"
              value={formatDuration(data.totals.avgDurationMs)}
              description="Run start to terminal state"
              icon={ClockIcon}
            />
          </div>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{isDaily ? "Daily spend" : "Monthly spend"}</CardTitle>
                <CardDescription>
                  Estimated USD by run start {isDaily ? "day" : "month"}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={spendChartConfig} className="h-[260px] w-full">
                  <AreaChart accessibilityLayer data={data.periods}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="period"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value) =>
                        formatPeriod(String(value), data.window.granularity)
                      }
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      width={44}
                      tickFormatter={(value) => `$${Number(value).toFixed(2)}`}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => formatMoney(Number(value))}
                        />
                      }
                    />
                    <Area
                      dataKey="spendUsd"
                      type="monotone"
                      fill="var(--color-spendUsd)"
                      fillOpacity={0.25}
                      stroke="var(--color-spendUsd)"
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  {isDaily ? "Daily token usage" : "Monthly token usage"}
                </CardTitle>
                <CardDescription>Input, output, and cache-read tokens.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={tokenChartConfig} className="h-[260px] w-full">
                  <BarChart accessibilityLayer data={data.periods}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="period"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value) =>
                        formatPeriod(String(value), data.window.granularity)
                      }
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      width={52}
                      tickFormatter={(value) => formatCompactNumber(Number(value))}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="inputTokens"
                      stackId="tokens"
                      fill="var(--color-inputTokens)"
                      radius={4}
                    />
                    <Bar
                      dataKey="cacheReadInputTokens"
                      stackId="tokens"
                      fill="var(--color-cacheReadInputTokens)"
                      radius={4}
                    />
                    <Bar
                      dataKey="outputTokens"
                      stackId="tokens"
                      fill="var(--color-outputTokens)"
                      radius={4}
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <BreakdownChart
              title="Per-agent spend"
              description="Top agents by estimated spend."
              data={data.agents.slice(0, 8).map((row) => ({
                name: row.displayName,
                spendUsd: row.spendUsd,
              }))}
              config={agentChartConfig}
              dataKey="spendUsd"
              valueFormatter={formatMoney}
            />
            <BreakdownChart
              title="Per-model usage"
              description="Token volume by configured or observed model."
              data={data.models.slice(0, 8).map((row) => ({
                name: shortModelName(row.model),
                totalTokens: row.totalTokens,
              }))}
              config={modelChartConfig}
              dataKey="totalTokens"
              valueFormatter={formatTokens}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <SurfaceBreakdownChart surfaces={data.surfaces} />
            <BreakdownChart
              title="Per-provider usage"
              description="Token volume by model provider."
              data={data.providers.slice(0, 8).map((row) => ({
                name: formatProviderLabel(row.provider),
                totalTokens: row.totalTokens,
              }))}
              config={providerChartConfig}
              dataKey="totalTokens"
              valueFormatter={formatTokens}
            />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SectionHeading
                title="Agents"
                description="Runs, spend, reliability, and latency per agent."
              />
              <Tabs
                value={surfaceFilter}
                onValueChange={(value) => {
                  if (
                    value === "all" ||
                    value === "chat" ||
                    value === "email" ||
                    value === "workflow"
                  ) {
                    setSurfaceFilter(value);
                  }
                }}
              >
                <TabsList aria-label="Filter agents by surface">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="chat">Chat</TabsTrigger>
                  <TabsTrigger value="email">Email</TabsTrigger>
                  <TabsTrigger value="workflow">Workflow</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <AnalyticsTable rows={filteredAgents} surfaceFilter={surfaceFilter} />
          </section>
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ActivityIcon />
            </EmptyMedia>
            <EmptyTitle>No analytics available</EmptyTitle>
            <EmptyDescription>
              Run activity will appear here once agents start processing work.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

function SurfaceBreakdownChart({
  surfaces,
}: {
  surfaces: Array<AnalyticsMetricRow & { surface: AnalyticsSurface }>;
}) {
  const data = surfaces
    .filter((row) => row.runs > 0)
    .map((row) => ({
      surface: row.surface,
      label: formatSurfaceLabel(row.surface),
      spendUsd: row.spendUsd,
      runs: row.runs,
    }));

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Surface breakdown</CardTitle>
          <CardDescription>Spend share across chat, email, and workflow.</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="min-h-[260px] border border-dashed">
            <EmptyHeader>
              <EmptyTitle>No surface activity yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Surface breakdown</CardTitle>
        <CardDescription>
          Estimated spend share across chat, email, and workflow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={surfaceChartConfig} className="h-[260px] w-full">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    if (name === "spendUsd") return formatMoney(Number(value));
                    return String(value);
                  }}
                />
              }
            />
            <Pie
              data={data}
              dataKey="spendUsd"
              nameKey="label"
              innerRadius={56}
              outerRadius={88}
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell key={entry.surface} fill={SURFACE_COLORS[entry.surface]} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey="label" />} />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {title}
        </CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function BreakdownChart({
  title,
  description,
  data,
  config,
  dataKey,
  valueFormatter,
}: {
  title: string;
  description: string;
  data: Array<Record<string, string | number>>;
  config: ChartConfig;
  dataKey: string;
  valueFormatter: (value: number) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-[260px] w-full">
          <BarChart accessibilityLayer data={data} layout="vertical">
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => formatCompactNumber(Number(value))}
            />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              width={118}
              tickFormatter={(value) => truncateLabel(String(value))}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => valueFormatter(Number(value))}
                />
              }
            />
            <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function AnalyticsTable({
  rows,
  surfaceFilter,
}: {
  rows: Array<{ agent: AnalyticsAgentRow; metrics: AnalyticsMetricRow }>;
  surfaceFilter: SurfaceFilter;
}) {
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ActivityIcon />
          </EmptyMedia>
          <EmptyTitle>No agent runs yet</EmptyTitle>
          <EmptyDescription>
            {surfaceFilter === "all"
              ? "Usage and reliability details will appear after the first run."
              : `No ${formatSurfaceLabel(surfaceFilter).toLowerCase()} runs in this time range.`}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Surfaces</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Error rate</TableHead>
            <TableHead className="text-right">Avg time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ agent, metrics }) => (
            <TableRow key={agent.slug}>
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{agent.displayName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {agent.slug}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {agent.bySurface
                    .filter((row) => row.runs > 0)
                    .map((row) => (
                      <Badge key={row.surface} variant="outline">
                        {formatSurfaceLabel(row.surface)}
                      </Badge>
                    ))}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {metrics.runs.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatTokens(metrics.totalTokens)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(metrics.spendUsd)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPercent(metrics.errorRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDuration(metrics.avgDurationMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Skeleton key={idx} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

function resolveAgentMetrics(
  agent: AnalyticsAgentRow,
  surfaceFilter: SurfaceFilter,
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

function defaultCustomRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPeriod(period: string, granularity: "day" | "month"): string {
  const [year, rawMonth, rawDay] = period.split("-");
  const date = new Date(Number(year), Number(rawMonth) - 1, Number(rawDay ?? "1"));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: granularity === "day" ? "numeric" : undefined,
  });
}

function formatSurfaceLabel(surface: AnalyticsSurface): string {
  if (surface === "workflow") return "Workflow";
  return surface.charAt(0).toUpperCase() + surface.slice(1);
}

function formatProviderLabel(provider: string): string {
  return provider.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 10 ? 2 : 4,
  }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatTokens(value: number): string {
  return `${formatCompactNumber(value)} tokens`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function truncateLabel(value: string): string {
  return value.length > 18 ? `${value.slice(0, 15)}...` : value;
}

function shortModelName(model: string): string {
  return model.replace(/^claude-/, "").replace(/-/g, " ");
}
