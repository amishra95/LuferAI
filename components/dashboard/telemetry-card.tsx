import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Sparkline } from "@/components/dashboard/sparkline";
import { cn } from "@/lib/utils";
import type { TelemetryMetric } from "@/types/telemetry";

export function TelemetryCard({ metric }: { metric: TelemetryMetric }) {
  const { label, value, unit, detail, delta, higherIsBetter, series, format } = metric;
  const good = delta === 0 || delta > 0 === higherIsBetter;
  const Trend = delta >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="label-mono">{label}</p>
        <span
          className={cn("inline-flex items-center gap-0.5 font-mono text-[11px] tabular-nums", good ? "text-sage" : "text-rose")}
          title={`${good ? "Better" : "Worse"} than the previous 2 hours`}
        >
          <Trend className="size-3" strokeWidth={2} aria-hidden />
          {Math.abs(delta * 100).toFixed(1)}%<span className="sr-only">{good ? " better" : " worse"}</span>
        </span>
      </div>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-fg font-mono text-[28px] leading-none font-medium tracking-[-0.03em] tabular-nums">{value}</span>
        {unit && <span className="text-fg-subtle font-mono text-[11.5px]">{unit}</span>}
      </p>
      <p className="text-fg-subtle mt-2 font-mono text-[11.5px]">{detail}</p>

      <div className="mt-5 -mb-1">
        <Sparkline data={series} format={format} label={`${label}, last 2 hours`} />
      </div>
    </div>
  );
}
