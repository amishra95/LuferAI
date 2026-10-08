import { AlertTriangle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMs } from "@/lib/telemetry/format";
import type { SpanRecord, SpanStats, TraceRecord, TraceSummary } from "@/lib/tracer";
import { cn } from "@/lib/utils";

/**
 * Trace analytics for /admin/analytics (lib/tracer.ts): per-route latency and
 * error rate, the slowest operations by p95, and recent failed traces as span
 * waterfalls. Failures use the reserved critical red with an icon and text.
 */

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const int = (n: number) => n.toLocaleString("en-IN");

function ErrorRate({ errors, count }: { errors: number; count: number }) {
  const rate = count ? (errors / count) * 100 : 0;
  if (errors === 0) return <>0%</>;
  return (
    <span className="inline-flex items-center gap-1 text-rose">
      <AlertTriangle className="size-3" aria-hidden />
      {rate.toFixed(rate < 10 ? 1 : 0)}%<span className="sr-only">, {errors} failed</span>
    </span>
  );
}

function StatsTable({ rows, label, caption }: { rows: SpanStats[]; label: string; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{label}</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Errors</TableHead>
            <TableHead className="hidden text-right sm:table-cell">p50</TableHead>
            <TableHead className="text-right">p95</TableHead>
            <TableHead className="hidden text-right md:table-cell">Max</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name}>
              <TableCell className="max-w-[16rem] truncate font-mono text-[12.5px]" title={r.name}>
                {r.name}
              </TableCell>
              <TableCell className="text-right tabular-nums">{int(r.count)}</TableCell>
              <TableCell className="text-right tabular-nums">
                <ErrorRate errors={r.errors} count={r.count} />
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatMs(r.p50Ms)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMs(r.p95Ms)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatMs(r.maxMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

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

function Waterfall({ trace }: { trace: TraceRecord }) {
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

export function TracePanels({ summary, rangeLabel, source }: { summary: TraceSummary; rangeLabel: string; source: "redis" | "memory" }) {
  const { routes, operations, failures } = summary;
  return (
    <section aria-labelledby="traces-heading" className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 id="traces-heading" className="display-heading text-[24px] leading-tight">
          Traces
        </h2>
        <p className="text-fg-subtle font-mono text-[11px] tabular-nums">
          {int(summary.traces)} traces · last {rangeLabel}
          {summary.trimmedBefore && ` · since ${when.format(new Date(summary.trimmedBefore))}`}
        </p>
      </div>

      {summary.traces === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-fg text-[13.5px] font-medium">No traces in the last {rangeLabel}</p>
            <p className="text-fg-subtle mx-auto mt-1 max-w-md text-[12.5px]">
              Chat, the AI tools in the portals, the WhatsApp/Slack webhooks and their reply workflow are traced as they run.
              {source === "memory" && " Upstash Redis isn't configured, so traces only cover this server instance."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 2xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Routes</CardTitle>
                <CardDescription>Requests, webhooks and workflow steps · a request counts as an error if anything in it failed</CardDescription>
              </CardHeader>
              <CardContent>
                <StatsTable rows={routes} label="Route" caption="Latency and error rate per route" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Slowest operations</CardTitle>
                <CardDescription>Model calls, tools and data work, by p95</CardDescription>
              </CardHeader>
              <CardContent>
                {operations.length ? (
                  <StatsTable rows={operations.slice(0, 10)} label="Operation" caption="Slowest operations by 95th-percentile latency" />
                ) : (
                  <p className="text-fg-subtle py-4 text-[13px]">No child spans recorded yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent failed traces</CardTitle>
              <CardDescription>Newest first · bars show when each span ran within its trace</CardDescription>
            </CardHeader>
            <CardContent>
              {failures.length === 0 ? (
                <p className="text-fg-subtle py-4 text-[13px]">No failed traces in the last {rangeLabel}.</p>
              ) : (
                <ul className="divide-line divide-y">
                  {failures.map((t, i) => {
                    // Lead with the root cause: the first failing child, not the route's own status.
                    const failedSpan = t.spans.slice(1).find((s) => s.status === "error") ?? t.spans[0];
                    return (
                      <li key={t.traceId} className="py-3 first:pt-0 last:pb-0">
                        <details open={i === 0} className="group">
                          <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5 [&::-webkit-details-marker]:hidden">
                            <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px] text-rose">
                              <AlertTriangle className="size-3.5" aria-hidden />
                              {t.name}
                            </span>
                            <span className="text-fg-subtle text-[12px]">
                              {when.format(new Date(t.start))} · {formatMs(t.durationMs)} · {t.spans.length} span{t.spans.length === 1 ? "" : "s"}
                              {t.droppedSpans > 0 && ` (+${t.droppedSpans} dropped)`}
                            </span>
                            {failedSpan?.error && <span className="text-fg-muted w-full truncate text-[12px]">{failedSpan.name}: {failedSpan.error.message}</span>}
                            <span className="text-fg-faint font-mono text-[10.5px]">trace {t.traceId.slice(0, 12)}</span>
                          </summary>
                          <div className="mt-3">
                            <Waterfall trace={t} />
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
