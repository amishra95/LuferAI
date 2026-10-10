/**
 * Connects an EventSource to /api/telemetry/stream and turns what it hears into
 * stream actions (lib/telemetry/stream-state.ts). Separate from the React hook
 * and with the EventSource constructor injected, so tests can drive it with a
 * fake (tests/telemetry-stream.test.mjs).
 */
import { parseTelemetryEvent, SSE_EVENT, type TelemetryEvent } from "./events.ts";
import type { TelemetryStreamAction } from "./stream-state.ts";

/** The slice of EventSource this uses. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((ev: never) => unknown) | null;
  onerror: ((ev: never) => unknown) | null;
  addEventListener(type: string, listener: (ev: { data: string }) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

/** EventSource.CLOSED: the browser has given up (an HTTP error, not a dropped connection). */
const CLOSED = 2;

export interface StreamOptions {
  url: string;
  /** Resume after this seq (e.g. after the tab was hidden). 0 = new events only. */
  since?: number;
  /** Events arriving within this window are dispatched together (one render). */
  batchMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Opens the stream; returns a function that closes it. */
export function connectTelemetryStream(
  create: EventSourceFactory,
  dispatch: (action: TelemetryStreamAction) => void,
  { url, since = 0, batchMs = 100, now = Date.now, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }: StreamOptions
): () => void {
  dispatch({ type: "connecting" });
  const source = create(since > 0 ? `${url}?${new URLSearchParams({ since: String(since) })}` : url);

  let queue: TelemetryEvent[] = [];
  let timer: unknown = null;
  const flush = () => {
    timer = null;
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    dispatch({ type: "events", events, receivedAt: now() });
  };

  source.onopen = () => dispatch({ type: "open" });
  source.onerror = () => dispatch({ type: "error", retrying: source.readyState !== CLOSED });
  source.addEventListener(SSE_EVENT, (message) => {
    const event = parseTelemetryEvent(message.data);
    if (!event) return;
    queue.push(event);
    timer ??= setTimer(flush, batchMs);
  });

  return () => {
    if (timer !== null) clearTimer(timer);
    flush();
    source.onopen = null;
    source.onerror = null;
    source.close();
  };
}
