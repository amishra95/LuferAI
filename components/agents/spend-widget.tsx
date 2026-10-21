"use client";

import { useState } from "react";

import { useTelemetry } from "@/components/workspace/workspace-provider";
import { formatTokens, formatUsd, type SpendSummary, type SpendTotals } from "@/lib/agents/spend";
import { cn } from "@/lib/utils";

const DAY_LABEL = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (day: string) => DAY_LABEL.format(new Date(`${day}T00:00:00Z`));

/**
 * Token usage and spend from agent_execution_logs: three rolling windows, the
 * last 14 days' cost, and the agents and models behind it. Server-rendered;
 * /agents re-renders on each run event (LiveRefresh), so it stays current.
 */
export function SpendWidget({ summary, store, agentNames }: { summary: SpendSummary; store: "supabase" | "memory"; agentNames: Record<string, string> }) {
  const { status } = useTelemetry();
  const live = status === "live";
  const unpriced = summary.last30d.unpriced;

  return (
    <section aria-labelledby="spend-heading" className="panel mb-6 overflow-hidden">
      <header className="border-line flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-5 py-3">
        <h2 id="spend-heading" className="text-fg text-body font-medium">
          Token usage &amp; spend
        </h2>
        <span className="text-fg-subtle text-caption">List prices, USD · {store === "supabase" ? "all instances" : "this instance only"}</span>
        <span className={cn("ml-auto inline-flex items-center gap-1.5 font-mono text-caption", live ? "text-fg-subtle" : "text-fg-faint")}>
          <span aria-hidden className={live ? "status-dot bg-sage" : "size-1.5 rounded-full bg-current"} />
          {live ? "live" : "paused"}
        </span>
      </header>

      <dl className="divide-line grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Tile label="Last 24 hours" totals={summary.last24h} />
        <Tile label="Last 7 days" totals={summary.last7d} />
        <Tile label="Last 30 days" totals={summary.last30d} />
      </dl>

      <div className="border-line grid gap-6 border-t px-5 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <DailyCost days={summary.daily} />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <Breakdown title="By agent" rows={summary.byAgent.slice(0, 5).map((r) => ({ key: r.agentKey, label: agentNames[r.agentKey] ?? r.agentKey, ...r }))} />
          <Breakdown title="By model" rows={summary.byModel.slice(0, 4).map((r) => ({ key: r.model, label: r.model, mono: true, ...r }))} />
        </div>
      </div>

      {unpriced > 0 && (
        <p className="text-fg-subtle border-line border-t px-5 py-2.5 text-caption">
          {unpriced} call{unpriced === 1 ? "" : "s"} used a model without a listed price and {unpriced === 1 ? "isn't" : "aren't"} in the cost.
        </p>
      )}
    </section>
  );
}

function Tile({ label, totals }: { label: string; totals: SpendTotals }) {
  return (
    <div className="px-5 py-4">
      <dt className="label-mono">{label}</dt>
      <dd className="text-fg mt-2 font-mono text-title leading-none tabular-nums">{formatUsd(totals.cost)}</dd>
      <dd className="text-fg-subtle mt-2 font-mono text-caption tabular-nums">
        {formatTokens(totals.promptTokens)} in · {formatTokens(totals.completionTokens)} out · {totals.calls} call{totals.calls === 1 ? "" : "s"}
      </dd>
    </div>
  );
}

/** One column per IST day; the column is its own hover/focus target, with the value in a tooltip. */
function DailyCost({ days }: { days: SpendSummary["daily"] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.cost), 0);
  const total = days.reduce((t, d) => t + d.cost, 0);
  const shown = active === null ? null : days[active];

  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex items-baseline justify-between gap-3">
        <span className="label-mono">Daily cost · 14 days</span>
        <span className="text-fg-subtle font-mono text-caption tabular-nums" aria-live="polite">
          {shown ? `${dayLabel(shown.day)}: ${formatUsd(shown.cost)} · ${formatTokens(shown.tokens)} tokens` : `${formatUsd(total)} total`}
        </span>
      </figcaption>
      {max === 0 ? (
        <p className="text-fg-faint border-line flex h-24 items-center justify-center rounded-md border border-dashed text-caption">No model calls in the last 14 days.</p>
      ) : (
        <div className="border-line flex h-24 items-end gap-[2px] border-b" role="list" aria-label="Cost per day">
          {days.map((d, i) => (
            <div
              key={d.day}
              role="listitem"
              tabIndex={0}
              aria-label={`${dayLabel(d.day)}: ${formatUsd(d.cost)}, ${formatTokens(d.tokens)} tokens`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              // The whole slot is the hit target; the column inside is capped at 24px.
              className="group flex h-full flex-1 cursor-default items-end justify-center outline-none"
            >
              <span
                className={cn(
                  "w-full max-w-6 rounded-t-[4px] transition-colors",
                  d.cost > 0 ? (active === i ? "bg-chart-1" : "bg-chart-1/55 group-focus-visible:bg-chart-1") : "bg-line h-px"
                )}
                style={d.cost > 0 ? { height: `${Math.max(3, (d.cost / max) * 100)}%` } : undefined}
              />
            </div>
          ))}
        </div>
      )}
      <div className="text-fg-faint mt-1.5 flex justify-between font-mono text-caption" aria-hidden>
        <span>{dayLabel(days[0].day)}</span>
        <span>today</span>
      </div>
    </figure>
  );
}

function Breakdown({ title, rows }: { title: string; rows: ({ key: string; label: string; mono?: boolean } & SpendTotals)[] }) {
  const max = Math.max(...rows.map((r) => r.cost), 0);
  return (
    <div className="min-w-0">
      <h3 className="label-mono mb-2">{title} · 30 days</h3>
      {rows.length === 0 ? (
        <p className="text-fg-faint text-caption">Nothing yet.</p>
      ) : (
        <table className="w-full table-fixed text-meta">
          <colgroup>
            <col />
            <col className="w-20" />
            <col className="w-16" />
          </colgroup>
          <thead className="sr-only">
            <tr>
              <th>{title.replace("By ", "")}</th>
              <th>Cost</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="align-baseline">
                <td className="py-1 pr-3">
                  <span className={cn("text-fg block truncate", r.mono && "font-mono text-caption")}>{r.label}</span>
                  <span aria-hidden className="bg-surface-raised mt-1 block h-1 overflow-hidden rounded-full">
                    <span className="bg-fg/55 block h-full rounded-full" style={{ width: `${max ? (r.cost / max) * 100 : 0}%` }} />
                  </span>
                </td>
                <td className="text-fg py-1 text-right font-mono tabular-nums">{formatUsd(r.cost)}</td>
                <td className="text-fg-subtle py-1 pl-3 text-right font-mono text-caption tabular-nums">{formatTokens(r.promptTokens + r.completionTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
