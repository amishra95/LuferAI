"use client";

import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";

import { DataTable } from "@/components/admin/spend-charts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { RunBucket } from "@/lib/telemetry/metrics";

/**
 * Agent run charts for /admin/analytics, matching spend-charts.tsx: recessive
 * axes, a hover tooltip on every mark and a table view underneath. Failures use
 * the reserved critical red, always with an icon and a label, never colour alone.
 */

const HOUR_MS = 3_600_000;
const axis = { stroke: "var(--color-zinc-300)", tick: { fill: "var(--color-zinc-500)", fontSize: 12 }, tickLine: false, axisLine: false } as const;

const hourFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** Bucket label in IST: "14:00" for hourly buckets, "8 Oct" for daily ones. */
export const bucketLabel = (start: string, bucketMs: number) => (bucketMs <= HOUR_MS ? hourFmt : dayFmt).format(new Date(start));

export const formatMs = (ms: number | null) => (ms === null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

type Row = RunBucket & { label: string; failedTag: string };

function rowsOf(buckets: RunBucket[], bucketMs: number): Row[] {
  return buckets.map((b) => ({ ...b, label: bucketLabel(b.start, bucketMs), failedTag: b.failed ? String(b.failed) : "" }));
}

// ----------------------------------------------------------------------------

const runsConfig = {
  ok: { label: "Succeeded", color: "var(--chart-1)" },
  failed: { label: "Failed", color: "var(--chart-critical)" },
} satisfies ChartConfig;

export function RunsChart({ buckets, bucketMs }: { buckets: RunBucket[]; bucketMs: number }) {
  const data = rowsOf(buckets, bucketMs);
  const failed = buckets.reduce((s, b) => s + b.failed, 0);

  return (
    <div>
      {/* Two series: a legend always, with the failure count called out in text. */}
      <ul className="text-fg-muted mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: "var(--chart-1)" }} />
          Succeeded
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: "var(--chart-critical)" }} />
          Failed
          {failed > 0 && (
            <span className="inline-flex items-center gap-1 text-red-700">
              <AlertTriangle className="size-3" aria-hidden />
              {failed} in this period
            </span>
          )}
        </li>
      </ul>
      <ChartContainer config={runsConfig} className="aspect-auto h-60 w-full">
        <BarChart data={data} margin={{ left: 4, right: 8, top: 16 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke="var(--color-zinc-700)" strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={12} />
          <YAxis {...axis} width={36} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: "var(--color-zinc-700)", opacity: 0.4 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as Row | undefined;
                  return p ? `${p.label} · ${(p.ok + p.failed).toLocaleString("en-IN")} runs` : "";
                }}
                formatter={(value, name) => (
                  <span className="flex w-full justify-between gap-4">
                    <span className="text-fg-subtle">{name === "failed" ? "Failed" : "Succeeded"}</span>
                    <span className="text-fg font-medium tabular-nums">{Number(value).toLocaleString("en-IN")}</span>
                  </span>
                )}
              />
            }
          />
          {/* A surface-coloured stroke leaves a 2px gap between the stacked segments. */}
          <Bar dataKey="ok" stackId="runs" fill="var(--color-ok)" stroke="var(--color-surface)" strokeWidth={1} maxBarSize={28} />
          <Bar dataKey="failed" stackId="runs" fill="var(--color-failed)" stroke="var(--color-surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28}>
            {/* Direct labels on failures only: the series that needs attention. */}
            <LabelList dataKey="failedTag" position="top" offset={4} fill="var(--color-zinc-700)" fontSize={11} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <DataTable
        caption="Agent runs by period"
        head={["Period", "Succeeded", "Failed", "Tokens"]}
        rows={data.map((r) => [r.label, r.ok, r.failed, r.tokens.toLocaleString("en-IN")])}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------

const latencyConfig = { p50Ms: { label: "Median latency", color: "var(--chart-1)" } } satisfies ChartConfig;

export function LatencyChart({ buckets, bucketMs }: { buckets: RunBucket[]; bucketMs: number }) {
  const data = rowsOf(buckets, bucketMs);
  if (buckets.every((b) => b.p50Ms === null)) {
    return <p className="text-fg-faint py-10 text-center text-sm">No runs to measure in this period.</p>;
  }
  return (
    <div>
      <ChartContainer config={latencyConfig} className="aspect-auto h-60 w-full">
        <LineChart data={data} margin={{ left: 4, right: 12, top: 16 }}>
          <CartesianGrid vertical={false} stroke="var(--color-zinc-700)" strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} tickMargin={8} minTickGap={12} />
          <YAxis {...axis} width={52} tickFormatter={(v) => formatMs(Number(v))} />
          <ChartTooltip
            cursor={{ stroke: "var(--color-zinc-500)" }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(_, payload) => (payload?.[0]?.payload as Row | undefined)?.label ?? ""}
                formatter={(value) => (
                  <span className="flex w-full justify-between gap-4">
                    <span className="text-fg-subtle">p50</span>
                    <span className="text-fg font-medium tabular-nums">{formatMs(Number(value))}</span>
                  </span>
                )}
              />
            }
          />
          {/* Gaps where nothing ran: no fake zero-latency readings. */}
          <Line
            dataKey="p50Ms"
            type="monotone"
            stroke="var(--color-p50Ms)"
            strokeWidth={2}
            connectNulls={false}
            dot={{ r: 3, strokeWidth: 2, stroke: "var(--color-surface)", fill: "var(--color-p50Ms)" }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-white)" }}
          />
        </LineChart>
      </ChartContainer>
      <DataTable caption="Median agent latency by period" head={["Period", "p50"]} rows={data.map((r) => [r.label, formatMs(r.p50Ms)])} />
    </div>
  );
}
