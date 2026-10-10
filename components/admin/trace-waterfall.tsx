import { AlertTriangle } from "lucide-react";

import { formatMs } from "@/lib/telemetry/format";
import type { SpanRecord, TraceRecord } from "@/lib/tracer";
import { cn } from "@/lib/utils";

/**
 * A trace's spans as a waterfall: tree order, indented by depth, bars placed
 * where each span ran within the trace. Shared by /admin/analytics and the
 * workspace inspector, so it has no server-only imports.
 */

/** Spans in tree order (parents before children) with their depth. */
function ordered(trace: TraceRecord): { span: SpanRecord; depth: number }[] {
  const kids = new Map<string | null, SpanRecord[]>();
  for (const s of trace.spans) kids.set(s.parentId, [...(kids.get(s.parentId) ?? []), s]);
  const ids = new Set(trace.spans.map((s) => s.spanId));
  const out: { span: SpanRecord; depth: number }[] = [];
  const walk = (span: SpanRecord, depth: number) => {
    out.push({ span, depth });
    for (const c of (kids.get(span.spanId) ?? []).sort((a, b) => a.start - b.start)) walk(c, depth + 1);
  };
  // Roots, plus spans whose parent was dropped by the size cap.
  for (const s of trace.spans) if (s.parentId === null || !ids.has(s.parentId)) walk(s, s.parentId === null ? 0 : 1);
  return out;
}

const attrText = (a: SpanRecord["attributes"]) =>
  Object.entries(a)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");

export function TraceWaterfall({ trace }: { trace: TraceRecord }) {
  const total = Math.max(trace.durationMs, 1);
  return (
    <ol className="space-y-1" aria-label={`Spans of ${trace.name}`}>
      {ordered(trace).map(({ span, depth }) => {
        const left = Math.min(100, Math.max(0, ((span.start - trace.start) / total) * 100));
        const width = Math.max(0.6, Math.min(100 - left, (span.durationMs / total) * 100));
        const failed = span.status === "error";
        const attrs = attrText(span.attributes);
        return (
          <li key={span.spanId} className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_4.5rem] sm:items-center sm:gap-3">
            <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px]" style={{ paddingLeft: `${depth * 12}px` }}>
              {failed && <AlertTriangle className="size-3 shrink-0 text-rose" aria-label="Failed" />}
              <span className={cn("truncate", failed ? "text-rose" : "text-fg")} title={span.name}>
                {span.name}
              </span>
            </span>
            <span className="bg-surface-raised relative block h-2.5 rounded-full" aria-hidden>
              <span
                className="absolute inset-y-0 rounded-full"
                style={{ left: `${left}%`, width: `${width}%`, background: failed ? "var(--chart-critical)" : "var(--chart-1)" }}
              />
            </span>
            <span className="text-fg-muted text-right font-mono text-[12px] tabular-nums">{formatMs(span.durationMs)}</span>
            {(span.error || attrs) && (
              <span className="text-fg-subtle col-span-full -mt-0.5 font-mono text-[11px] break-all" style={{ paddingLeft: `${depth * 12 + (failed ? 18 : 0)}px` }}>
                {span.error && <span className="text-rose">{span.error.name}: {span.error.message}</span>}
                {span.error && attrs && " · "}
                {attrs}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
