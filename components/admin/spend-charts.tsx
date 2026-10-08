"use client";

import { AlertTriangle } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { DepartmentUsage, MonthPoint } from "@/lib/data/analytics";
import { formatINR } from "@/lib/utils";

/**
 * Executive spend charts. Each is a single series in --chart-1 (validated on the
 * white surface), so the card title names it and no legend is needed. Status
 * red is reserved for over-budget bars and always comes with an icon + label.
 * Every chart has a hover tooltip and a table view underneath.
 */

const compactINR = (n: number) =>
  n >= 10_000_000
    ? `₹${(n / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}Cr`
    : n >= 100_000
      ? `₹${(n / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L`
      : n >= 1000
        ? `₹${Math.round(n / 1000)}k`
        : `₹${n}`;

const axis = { stroke: "var(--color-zinc-300)", tick: { fill: "var(--color-zinc-500)", fontSize: 12 }, tickLine: false, axisLine: false } as const;

export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-fg-subtle hover:text-fg md:min-h-0">View as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-fg-subtle">
              {head.map((h, i) => (
                <th key={h} scope="col" className={i ? "py-1.5 text-right font-normal" : "py-1.5 font-normal"}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={String(r[0])}>
                {r.map((c, i) => (
                  <td key={i} className={i ? "py-1.5 text-right text-fg tabular-nums" : "py-1.5 text-fg-muted"}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ----------------------------------------------------------------------------

const spendConfig = { cumulative: { label: "FYTD spend", color: "var(--chart-1)" } } satisfies ChartConfig;

export function CumulativeSpendChart({ months }: { months: MonthPoint[] }) {
  return (
    <div>
      <ChartContainer config={spendConfig} className="aspect-auto h-64 w-full">
        <AreaChart data={months} margin={{ left: 4, right: 12, top: 8 }}>
          <defs>
            <linearGradient id="fill-cumulative" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-cumulative)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-cumulative)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-zinc-700)" strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} tickMargin={8} />
          <YAxis {...axis} width={56} tickFormatter={compactINR} />
          <ChartTooltip
            cursor={{ stroke: "var(--color-zinc-500)" }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as MonthPoint | undefined;
                  return p ? `${p.label} · ${formatINR(p.spend)} this month` : "";
                }}
                formatter={(value) => (
                  <span className="flex w-full justify-between gap-4">
                    <span className="text-fg-subtle">FYTD</span>
                    <span className="font-medium text-fg tabular-nums">{formatINR(Number(value))}</span>
                  </span>
                )}
              />
            }
          />
          <Area
            dataKey="cumulative"
            type="monotone"
            stroke="var(--color-cumulative)"
            strokeWidth={2}
            fill="url(#fill-cumulative)"
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-white)" }}
          />
        </AreaChart>
      </ChartContainer>
      <DataTable
        caption="Spend by month, financial year to date"
        head={["Month", "Spend", "FYTD"]}
        rows={months.map((m) => [m.label, formatINR(m.spend), formatINR(m.cumulative)])}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------

const deptConfig = { pct: { label: "Budget used", color: "var(--chart-1)" } } satisfies ChartConfig;

export function DepartmentBudgetChart({ departments }: { departments: DepartmentUsage[] }) {
  if (departments.length === 0) {
    return <p className="py-10 text-center text-sm text-fg-faint">No department budgets set yet.</p>;
  }
  const data = departments.slice(0, 8).map((d) => ({
    ...d,
    name: `${d.label} · ${d.company}`,
    // Long overruns are drawn to 130% so in-budget bars stay readable; the label shows the true figure.
    shown: Math.min(d.pct, 130),
    tag: d.pct > 100 ? `${Math.round(d.pct)}% · over` : `${Math.round(d.pct)}%`,
  }));
  const over = departments.filter((d) => d.pct > 100).length;
  // Quarter steps so the 100% budget line always lands on a tick.
  const xMax = Math.max(100, Math.ceil(Math.max(...data.map((d) => d.shown)) / 25) * 25);
  const ticks = Array.from({ length: xMax / 25 + 1 }, (_, i) => i * 25);

  return (
    <div>
      {over > 0 ? (
        <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-red-700">
          <AlertTriangle className="size-3.5" aria-hidden /> {over} department{over === 1 ? "" : "s"} over budget
        </p>
      ) : null}
      <ChartContainer config={deptConfig} className="aspect-auto w-full" style={{ height: Math.max(160, data.length * 44 + 40) }}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 64, top: 22, bottom: 4 }} barCategoryGap={10}>
          <CartesianGrid horizontal={false} stroke="var(--color-zinc-700)" strokeDasharray="3 3" />
          <XAxis type="number" domain={[0, xMax]} ticks={ticks} {...axis} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" {...axis} width={148} tickMargin={6} />
          <ReferenceLine x={100} stroke="var(--color-zinc-500)" strokeDasharray="4 4" label={{ value: "Budget", fill: "var(--color-zinc-500)", fontSize: 11, position: "top", offset: 8 }} />
          <ChartTooltip
            cursor={{ fill: "var(--color-zinc-700)", opacity: 0.4 }}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, payload) => (payload?.[0]?.payload as { name?: string } | undefined)?.name ?? ""}
                formatter={(_, __, item) => {
                  const d = item.payload as DepartmentUsage;
                  return (
                    <span className="text-fg tabular-nums">
                      {formatINR(d.spent)} of {formatINR(d.budget)} ({Math.round(d.pct)}%)
                    </span>
                  );
                }}
              />
            }
          />
          <Bar dataKey="shown" radius={[0, 4, 4, 0]} barSize={18}>
            {data.map((d) => (
              <Cell key={d.id} fill={d.pct > 100 ? "var(--chart-critical)" : "var(--color-pct)"} />
            ))}
            <LabelList dataKey="tag" position="right" offset={8} fill="var(--color-zinc-700)" fontSize={12} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <DataTable
        caption="Department budget usage this financial year"
        head={["Department", "Spent", "Budget", "Used"]}
        rows={departments.map((d) => [`${d.label} · ${d.company}`, formatINR(d.spent), formatINR(d.budget), `${Math.round(d.pct)}%`])}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------

const savingsConfig = { savings: { label: "Rate-card savings", color: "var(--chart-1)" } } satisfies ChartConfig;

export function SavingsChart({ months }: { months: MonthPoint[] }) {
  const total = months.reduce((s, m) => s + m.savings, 0);
  if (total === 0) {
    return <p className="py-10 text-center text-sm text-fg-faint">No rate-card discounts applied yet this year.</p>;
  }
  return (
    <div>
      <ChartContainer config={savingsConfig} className="aspect-auto h-56 w-full">
        <BarChart data={months} margin={{ left: 4, right: 8, top: 8 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--color-zinc-700)" strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} tickMargin={8} />
          <YAxis {...axis} width={52} tickFormatter={compactINR} />
          <ChartTooltip
            cursor={{ fill: "var(--color-zinc-700)", opacity: 0.4 }}
            content={<ChartTooltipContent formatter={(v) => <span className="font-medium text-fg tabular-nums">{formatINR(Number(v))} saved</span>} />}
          />
          <Bar dataKey="savings" fill="var(--color-savings)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ChartContainer>
      <DataTable
        caption="Rate-card savings by month"
        head={["Month", "Saved"]}
        rows={months.map((m) => [m.label, formatINR(m.savings)])}
      />
    </div>
  );
}
