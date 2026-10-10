/**
 * Client-side state of the live telemetry stream: connection status and a
 * bounded buffer of recent events, plus selectors the inspector uses. The
 * useTelemetryStream hook (components/workspace/use-telemetry-stream.ts) drives
 * it from an EventSource.
 *
 * Pure, so tests can import it directly (tests/telemetry-stream.test.mjs).
 */
import type { LiveRun, LiveSpan, TelemetryEvent } from "./events.ts";

/**
 * idle          not connected (signed out, or no live access)
 * connecting    first connection in progress
 * live          connected and receiving
 * reconnecting  dropped; EventSource is retrying
 * unavailable   the server refused the stream (401/403/5xx); not retried
 */
export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "unavailable";

export interface TelemetryStreamState {
  status: StreamStatus;
  /** Oldest first, capped at BUFFER_LIMIT. */
  events: TelemetryEvent[];
  /** Highest seq seen: later duplicates and replays are ignored. */
  lastSeq: number;
  /** Epoch ms of the last event received, or null. */
  lastEventAt: number | null;
}

export type TelemetryStreamAction =
  | { type: "connecting" }
  | { type: "open" }
  | { type: "events"; events: TelemetryEvent[]; receivedAt: number }
  /** The EventSource errored; `retrying` is false once it has given up (readyState CLOSED). */
  | { type: "error"; retrying: boolean }
  | { type: "stop" };

export const BUFFER_LIMIT = 300;

export const INITIAL_STREAM: TelemetryStreamState = Object.freeze({ status: "idle", events: Object.freeze([]) as unknown as TelemetryEvent[], lastSeq: 0, lastEventAt: null });

export function telemetryStreamReducer(state: TelemetryStreamState, action: TelemetryStreamAction): TelemetryStreamState {
  switch (action.type) {
    case "connecting":
      return state.status === "connecting" ? state : { ...state, status: state.status === "idle" || state.status === "unavailable" ? "connecting" : "reconnecting" };
    case "open":
      return state.status === "live" ? state : { ...state, status: "live" };
    case "events": {
      const fresh = action.events.filter((e) => e.seq > state.lastSeq).sort((a, b) => a.seq - b.seq);
      // Within one batch, also drop repeats of the same seq.
      const unique = fresh.filter((e, i) => i === 0 || e.seq !== fresh[i - 1].seq);
      if (unique.length === 0) return state;
      const events = [...state.events, ...unique];
      return {
        // An event proves the connection is up, even if `open` was missed.
        status: "live",
        events: events.length > BUFFER_LIMIT ? events.slice(events.length - BUFFER_LIMIT) : events,
        lastSeq: unique[unique.length - 1].seq,
        lastEventAt: action.receivedAt,
      };
    }
    case "error": {
      const status: StreamStatus = action.retrying ? "reconnecting" : "unavailable";
      return state.status === status ? state : { ...state, status };
    }
    case "stop":
      return state.status === "idle" ? state : { ...state, status: "idle" };
  }
}

// ----------------------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------------------

export interface LiveTrace {
  traceId: string;
  /** Ended spans, in start order. */
  spans: LiveSpan[];
  /** The root span has ended. */
  ended: boolean;
  /** The trace was stored (seq of that event), so it can be loaded in full. */
  storedSeq: number | null;
  status: "running" | "ok" | "error";
  /** Root name if ended, else the earliest span's. */
  name: string | null;
}

/** Spans streamed for one trace so far, deduped by span id. */
export function liveTrace(events: readonly TelemetryEvent[], traceId: string): LiveTrace | null {
  const spans = new Map<string, LiveSpan>();
  let root: LiveSpan | null = null;
  let storedSeq: number | null = null;
  for (const e of events) {
    if (e.type === "span" && e.traceId === traceId) {
      spans.set(e.span.spanId, e.span);
      if (e.root) root = e.span;
    } else if (e.type === "trace" && e.traceId === traceId) {
      storedSeq = e.seq;
    }
  }
  if (spans.size === 0 && storedSeq === null) return null;
  const list = [...spans.values()].sort((a, b) => a.start - b.start || a.spanId.localeCompare(b.spanId));
  const failed = list.some((s) => s.status === "error");
  return {
    traceId,
    spans: list,
    ended: root !== null,
    storedSeq,
    status: root === null ? "running" : failed ? "error" : "ok",
    name: root?.name ?? list[0]?.name ?? null,
  };
}

/** Runs streamed for one agent, newest first. */
export function liveRunsFor(events: readonly TelemetryEvent[], agentId: string): LiveRun[] {
  const out: LiveRun[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "run" && e.run.agent === agentId) out.push(e.run);
  }
  return out;
}

export function latestVenueSync(events: readonly TelemetryEvent[]): Extract<TelemetryEvent, { type: "venue-sync" }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "venue-sync") return e;
  }
  return null;
}

/**
 * The seq of the newest event that changes what the inspector shows for an
 * entity (a run or config change for an agent, the stored trace, a directory
 * sync or an edit to that listing), or 0. The
 * inspector reloads the entity when this moves.
 */
export function refreshSeqFor(events: readonly TelemetryEvent[], kind: string, id: string): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (kind === "agent" && e.type === "run" && e.run.agent === id) return e.seq;
    if (kind === "trace" && e.type === "trace" && e.traceId === id) return e.seq;
    if (kind === "agent" && e.type === "agent-config" && e.agentId === id) return e.seq;
    if (kind === "venue" && (e.type === "venue-sync" || (e.type === "venue-updated" && e.venueId === id))) return e.seq;
  }
  return 0;
}
