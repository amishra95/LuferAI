import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Sparkline } from "@/components/dashboard/sparkline";
import { cn } from "@/lib/utils";
import type { TelemetryMetric } from "@/types/telemetry";

/**
 * Headline metrics as one card divided into cells, rather than separate boxes:
 * label, value and change on top, a quiet trend line underneath.
 */
export function MetricStrip({ metrics }: { metrics: TelemetryMetric[] }) {
  return (
    <section className="panel grid grid-cols-2 overflow-hidden xl:grid-cols-4" aria-label="Key metrics">
      {metrics.map((m, i) => {
        const good = m.delta === 0 || m.delta > 0 === m.higherIsBetter;
        const Trend = m.delta >= 0 ? ArrowUpRight : ArrowDownRight;
        return (
          <div
            key={m.id}
            className={cn(
              "border-line flex min-w-0 flex-col px-4 pt-4 pb-3 sm:px-5 sm:pt-5",
              // Hairline dividers that follow the grid: 2×2 below xl, one row of four above.
              i % 2 === 1 && "border-l",
              i >= 2 && "border-t xl:border-t-0",
              i === 2 && "xl:border-l"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="label-mono truncate">{m.label}</p>
              <span
                className={cn("inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] tabular-nums", good ? "text-sage" : "text-rose")}
                title={`${good ? "Better" : "Worse"} than the previous 2 hours`}
              >
                <Trend className="size-3" strokeWidth={2} aria-hidden />
                {Math.abs(m.delta * 100).toFixed(1)}%<span className="sr-only">{good ? " better" : " worse"}</span>
              </span>
            </div>
            <p className="mt-3 flex items-baseline gap-1.5">
              <span className="text-fg font-mono text-[22px] leading-none font-medium tracking-[-0.03em] tabular-nums sm:text-[26px]">{m.value}</span>
              {m.unit && <span className="text-fg-subtle font-mono text-[11px]">{m.unit}</span>}
            </p>
            <p className="text-fg-subtle mt-1.5 truncate font-mono text-[11px]">{m.detail}</p>
            <div className="mt-3">
              <Sparkline data={m.series} format={m.format} label={`${m.label}, last 2 hours`} className="h-8" />
            </div>
          </div>
        );
      })}
    </section>
  );
}
