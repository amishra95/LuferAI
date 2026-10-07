import { TrendingDown, TrendingUp } from "lucide-react";

import { Sparkline } from "@/components/dashboard/sparkline";
import { cn } from "@/lib/utils";
import type { TelemetryMetric } from "@/types/telemetry";

export function TelemetryCard({ metric }: { metric: TelemetryMetric }) {
  const { label, value, unit, detail, delta, higherIsBetter, series, format } = metric;
  const good = delta === 0 || delta > 0 === higherIsBetter;
  const Trend = delta >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] tracking-wider text-zinc-500 uppercase">{label}</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
            good ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
          )}
          title="Change vs. previous 2 hours"
        >
          <Trend className="size-3" aria-hidden />
          {delta >= 0 ? "+" : "−"}
          {Math.abs(delta * 100).toFixed(1)}%
        </span>
      </div>

      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight text-zinc-50 tabular-nums">{value}</span>
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
      </p>
      <p className="mt-0.5 text-xs text-zinc-400">{detail}</p>

      <div className="mt-4">
        <Sparkline data={series} format={format} label={`${label}, last 2 hours`} />
      </div>
    </div>
  );
}
