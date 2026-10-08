import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import type { MetricChange } from "@/lib/telemetry/metrics";
import { cn } from "@/lib/utils";

const INTENT = {
  good: "border-sage/30 bg-sage/10 text-sage",
  bad: "border-rose/30 bg-rose/10 text-rose",
  neutral: "border-line bg-surface-raised text-fg-muted",
} as const;

const INTENT_TEXT = { good: "improvement", bad: "worse", neutral: "change" } as const;

/**
 * Financial-style change pill: hairline border, tinted fill, tabular mono
 * digits and a direction arrow. Colour follows intent (good / bad / neutral),
 * and the sign and arrow carry the direction too, so it never rides on colour.
 */
export function ChangePill({ change, className }: { change: MetricChange; className?: string }) {
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[11px] font-medium tracking-wide tabular-nums",
        INTENT[change.intent],
        className
      )}
    >
      <Icon className="size-3" strokeWidth={2.25} aria-hidden />
      {change.label}
      <span className="sr-only"> ({INTENT_TEXT[change.intent]})</span>
    </span>
  );
}

/** Headline metric for the portals, styled like the dashboard's telemetry cards. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  change,
}: {
  label: string;
  value: string;
  /** Context under the value; follows the change pill when there is one ("vs previous 7 days"). */
  hint?: string;
  icon?: LucideIcon;
  /** Change from the previous period, shown as a pill. */
  change?: MetricChange | null;
}) {
  return (
    <div className="panel relative isolate flex flex-col overflow-hidden p-5">
      {/* Concierge only: soft amber and white radiance behind the figures. */}
      <span aria-hidden className="pointer-events-none absolute -top-16 -right-12 -z-10 hidden size-44 rounded-full bg-amber-500/10 blur-3xl concierge:block" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 -z-10 hidden size-40 rounded-full bg-white/[0.035] blur-3xl concierge:block" />
      <div className="flex items-center justify-between gap-2">
        <p className="label-mono">{label}</p>
        {Icon ? <Icon className="text-fg-faint size-4" strokeWidth={1.75} aria-hidden /> : null}
      </div>
      <p className="text-fg concierge:mt-5 concierge:text-[30px] mt-4 font-mono text-[24px] leading-none font-medium tracking-[-0.03em] tabular-nums">{value}</p>
      {change || hint ? (
        <p className="text-fg-subtle concierge:mt-3 concierge:leading-5 mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          {change ? <ChangePill change={change} /> : null}
          {hint ? <span>{hint}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
