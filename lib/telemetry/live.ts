/**
 * The app's live telemetry log and the publishers that feed it: the tracer
 * (spans and stored traces), the agent run log and venue syncs. Read by
 * /api/telemetry/stream.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL / _TOKEN are set (shared by
 * every instance), otherwise process memory. Imported by lib/tracer.ts, so like
 * it: no server-only imports or path aliases.
 */
import { Redis } from "@upstash/redis";

import type { SpanRecord, TraceRecord, TracerEvent } from "../tracer.ts";
import { memoryEventLog, redisEventLog, type EventLog } from "./event-log.ts";
import type { LiveRun, LiveSpan, NewTelemetryEvent, PartnerSyncStatus } from "./events.ts";

const g = globalThis as typeof globalThis & { __luferEventLog?: EventLog };

/** Created on first use (and kept on globalThis across `next dev` reloads). */
export function appEventLog(): EventLog {
  if (g.__luferEventLog) return g.__luferEventLog;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  g.__luferEventLog = url && token ? redisEventLog(new Redis({ url, token })) : memoryEventLog();
  return g.__luferEventLog;
}

/** Hands the write to Next's after() inside a request; outside one it just runs. */
function defer(work: Promise<void>) {
  import("next/server")
    .then(({ after }) => after(work))
    .catch(() => {});
}

/** Publishes events. Fire-and-forget: never throws, never blocks the caller. */
export function publish(...events: NewTelemetryEvent[]): Promise<void> {
  let work: Promise<void>;
  try {
    work = appEventLog().append(events);
  } catch (err) {
    console.error("telemetry: could not publish events", err);
    return Promise.resolve();
  }
  defer(work);
  return work;
}

/** A span without its attributes: enough for a live waterfall, small on the wire. */
export function liveSpan(s: SpanRecord): LiveSpan {
  return {
    spanId: s.spanId,
    parentId: s.parentId,
    name: s.name,
    start: s.start,
    durationMs: s.durationMs,
    status: s.status,
    ...(s.error && { error: s.error }),
  };
}

export function traceEvent(trace: TraceRecord, at = Date.now()): NewTelemetryEvent {
  return { type: "trace", at, traceId: trace.traceId, name: trace.name, status: trace.status, durationMs: trace.durationMs, spans: trace.spans.length };
}

/** The tracer's onEvent hook. */
export function publishTracerEvent(event: TracerEvent): void {
  const at = Date.now();
  void publish(event.type === "span" ? { type: "span", at, traceId: event.traceId, root: event.root, span: liveSpan(event.span) } : traceEvent(event.trace, at));
}

export function publishRun(run: LiveRun): Promise<void> {
  return publish({ type: "run", at: Date.now(), run });
}

export function publishVenueSync(total: number, partners: PartnerSyncStatus): Promise<void> {
  return publish({ type: "venue-sync", at: Date.now(), total, partners });
}
