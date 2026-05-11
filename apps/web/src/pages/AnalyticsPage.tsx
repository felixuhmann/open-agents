import type { ComponentType } from "react";
import { useState } from "react";
import {
  ActivityIcon,
  ClockIcon,
  CoinsIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader, SectionHeading } from "@/components/PageHeader";
import {
  ChartContainer,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAnalyticsWindow, type AnalyticsMetricRow } from "@/lib/queries";

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

export default function AnalyticsPage() {
  const [window, setWindow] = useState<"30d" | "12m">("12m");
  const analytics = useAnalyticsWindow(window);
  const data = analytics.data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        description="Usage, cost, reliability, and latency across every agent surface."
        meta={
          data
            ? `${formatDate(data.window.from)} - ${formatDate(data.window.to)}`
            : window === "30d"
              ? "Last 30 days"
              : "Last 12 months"
        }
        actions={
          <ToggleGroup
            type="single"
            value={window}
            onValueChange={(value) => {
              if (value === "30d" || value === "12m") setWindow(value);
            }}
            aria-label="Analytics time frame"
          >
            <ToggleGroupItem value="30d">30 days</ToggleGroupItem>
            <ToggleGroupItem value="12m">12 months</ToggleGroupItem>
          </ToggleGroup>
        }
      />

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
                <CardTitle>Monthly spend</CardTitle>
                <CardDescription>Estimated USD by run start month.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={spendChartConfig} className="h-[260px] w-full">
                  <AreaChart accessibilityLayer data={data.monthly}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={formatMonth}
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
                <CardTitle>Monthly token usage</CardTitle>
                <CardDescription>Input, output, and cache-read tokens.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={tokenChartConfig} className="h-[260px] w-full">
                  <BarChart accessibilityLayer data={data.monthly}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={formatMonth}
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

          <section className="flex flex-col gap-3">
            <SectionHeading
              title="Agents"
              description="Runs, spend, reliability, and latency per agent."
            />
            <AnalyticsTable rows={data.agents} />
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
}: {
  rows: Array<AnalyticsMetricRow & { slug: string; displayName: string }>;
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
            Usage and reliability details will appear after the first run.
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
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Error rate</TableHead>
            <TableHead className="text-right">Avg time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.slug}>
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{row.displayName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.slug}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.runs.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatTokens(row.totalTokens)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(row.spendUsd)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPercent(row.errorRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatDuration(row.avgDurationMs)}
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

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonth(month: string): string {
  const [year, rawMonth] = month.split("-");
  return new Date(Number(year), Number(rawMonth) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
  });
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
