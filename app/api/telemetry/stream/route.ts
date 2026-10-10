import type { NextRequest } from "next/server";

import { authorize } from "@/lib/api/respond";
import { appEventLog } from "@/lib/telemetry/live";
import { encodeSseEvent, parseCursor, SSE_HEARTBEAT, sseRetry, visibleTo, type TelemetryAudience, type TelemetryEvent } from "@/lib/telemetry/events";
import { canInspect } from "@/lib/workspace/inspect";

/**
 * GET /api/telemetry/stream — Server-Sent Events of live telemetry: spans and
 * stored traces, agent runs and venue syncs (lib/telemetry/events.ts), filtered
 * to what the viewer may see (operator data for admins, venue syncs for anyone
 * with /venues).
 *
 * Starts at the log's head (new events only), or after `Last-Event-ID` /
 * `?since=` when resuming. A stream lives for ~50s and then ends; EventSource
 * reconnects with Last-Event-ID, so nothing is missed and no function runs
 * past its time limit. Deliberately not traced: tracing it would publish
 * events about itself.
 */

export const maxDuration = 60;

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const LIFETIME_MS = 50_000;
const RETRY_MS = 2000;
const BATCH = 100;

const NO_BUFFER = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-transform",
  Connection: "keep-alive",
  // Nginx-style proxies: don't hold the stream back.
  "X-Accel-Buffering": "no",
};

export async function GET(request: NextRequest) {
  const auth = await authorize((m) => canInspect(m, "agent") || canInspect(m, "venue"));
  if ("response" in auth) return auth.response;
  const audience: TelemetryAudience = { ops: canInspect(auth.member, "agent"), venues: canInspect(auth.member, "venue") };

  const log = appEventLog();
  const resume = parseCursor(request.headers.get("last-event-id")) ?? parseCursor(request.nextUrl.searchParams.get("since"));
  let cursor = resume ?? (await log.head());

  const encoder = new TextEncoder();
  const signal = request.signal;
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let polling = false;
      const send = (text: string) => !closed && controller.enqueue(encoder.encode(text));

      const deliver = (events: TelemetryEvent[]) => {
        for (const e of events) {
          if (e.seq <= cursor) continue;
          cursor = e.seq;
          if (visibleTo(e, audience)) send(encodeSseEvent(e));
        }
      };

      const poll = async () => {
        if (polling || closed) return;
        polling = true;
        try {
          // Drain: a burst bigger than one batch takes several reads.
          for (;;) {
            const { events, head } = await log.since(cursor, BATCH);
            deliver(events);
            // Fell behind the log's cap: skip what was trimmed.
            if (events.length === 0 && head > cursor) cursor = head;
            if (events.length < BATCH) break;
          }
        } catch (err) {
          console.error("telemetry stream: poll failed", err);
        } finally {
          polling = false;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe?.();
        signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      cleanup = close;

      send(sseRetry(RETRY_MS));
      // Same-instance events arrive at once; other instances' within a poll.
      const unsubscribe = log.subscribe?.(() => void poll());
      const pollTimer = setInterval(() => void poll(), POLL_MS);
      const heartbeat = setInterval(() => send(SSE_HEARTBEAT), HEARTBEAT_MS);
      const lifetime = setTimeout(close, LIFETIME_MS);
      signal.addEventListener("abort", close);
      // Catch up immediately when resuming.
      if (resume !== null) void poll();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: NO_BUFFER });
}
