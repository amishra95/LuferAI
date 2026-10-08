"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { TelemetryMetric } from "@/types/telemetry";

const W = 240;
const H = 48;
const PAD = 3;

const FORMATTERS: Record<TelemetryMetric["format"], (v: number) => string> = {
  int: (v) => Math.round(v).toLocaleString("en-US"),
  tokens: (v) => `${(v / 1000).toFixed(1)}k tok/min`,
  ms: (v) => `${Math.round(v)} ms`,
  percent: (v) => `${v.toFixed(1)}%`,
};

/**
 * Single-series trend line with a hover readout. No axes: it sits under a
 * headline number, which carries the actual value.
 */
export function Sparkline({
  data,
  label,
  format,
  bucketMinutes = 5,
  className,
}: {
  data: number[];
  /** Accessible name, e.g. "Token throughput, last 2 hours". */
  label: string;
  format: TelemetryMetric["format"];
  bucketMinutes?: number;
  /** Height utility for the plot; defaults to h-12. */
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const formatValue = FORMATTERS[format];

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1)))));
  }

  const minutesAgo = hover === null ? 0 : (data.length - 1 - hover) * bucketMinutes;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={cn("text-fg w-full touch-none overflow-visible", className ?? "h-12")}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="currentColor" fillOpacity={0.06} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-line-strong" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hover !== null && (
        <>
          {/* Marker drawn in HTML so it stays round under the stretched viewBox. */}
          <span
            className="bg-fg ring-canvas pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
            style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover]) / H) * 100}%` }}
            aria-hidden
          />
          <div
            className="border-line bg-elevated/95 text-fg pointer-events-none absolute -top-9 z-10 -translate-x-1/2 rounded-lg border px-2 py-1 font-mono text-[11px] whitespace-nowrap"
            style={{ left: `${Math.min(85, Math.max(15, (x(hover) / W) * 100))}%` }}
          >
            {formatValue(data[hover])}
            <span className="text-fg-subtle"> · {minutesAgo === 0 ? "now" : `${minutesAgo}m ago`}</span>
          </div>
        </>
      )}
    </div>
  );
}
