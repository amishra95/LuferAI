import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import type { MetricChange } from "@/lib/telemetry/metrics";
import { cn } from "@/lib/utils";

const INTENT = { good: "text-sage", bad: "text-rose", neutral: "text-fg-subtle" } as const;
const INTENT_TEXT = { good: "improvement", bad: "worse", neutral: "change" } as const;

/**
 * Change from the previous period: arrow + signed mono figure, coloured by
 * whether the move is good or bad (volume stays grey). The sign and arrow
 * carry the direction, so it never rides on colour.
 */
export function ChangePill({ change, className }: { change: MetricChange; className?: string }) {
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 font-mono text-caption tabular-nums", INTENT[change.intent], className)}>
      <Icon className="size-3" strokeWidth={2} aria-hidden />
      {change.label}
      <span className="sr-only"> ({INTENT_TEXT[change.intent]})</span>
    </span>
  );
}

/** Headline metric for the portals: label, figure, optional change and context. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  change,
  meter,
}: {
  label: string;
  value: string;
  /** Context under the value; follows the change when there is one ("vs previous 7 days"). */
  hint?: string;
  icon?: LucideIcon;
  /** Change from the previous period. */
  change?: MetricChange | null;
  /** A thin bar under the figure: share used (0–100+) and its accessible label. */
  meter?: { pct: number; label: string; tone?: "ok" | "warn" | "over" };
}) {
  return (
    <div className="panel flex min-w-0 flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="label-mono">{label}</p>
        {Icon ? <Icon className="text-fg-faint size-3.5" strokeWidth={1.75} aria-hidden /> : null}
      </div>
      <p className="text-fg mt-3 font-mono text-[1.4rem] leading-none sm:text-[1.75rem] font-semibold tracking-tight tabular-nums">{value}</p>
      {meter ? (
        <div role="meter" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(meter.pct, 100))} className="bg-surface-raised mt-3 h-1.5 overflow-hidden rounded-full">
          <div
            className={cn("h-full rounded-full", meter.tone === "over" ? "bg-error" : meter.tone === "warn" ? "bg-gold" : "bg-coral")}
            style={{ width: `${Math.max(2, Math.min(meter.pct, 100))}%` }}
          />
        </div>
      ) : null}
      {change || hint ? (
        <p className="text-fg-subtle mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
          {change ? <ChangePill change={change} /> : null}
          {hint ? <span>{hint}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
