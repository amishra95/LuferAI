/**
 * The live telemetry event log behind /api/telemetry/stream: a capped,
 * sequence-numbered list of recent events.
 *
 * - Redis (Upstash): one Lua script numbers a batch with INCR and pushes it, so
 *   seqs are unique and ordered across instances. Readers poll `since(cursor)`;
 *   the head counter is checked first, so an idle poll is a single GET.
 * - Memory: the same log in process memory, plus `subscribe` so a stream on this
 *   instance hears an event the moment it's appended.
 *
 * Appends are batched for a short window: a request that ends a dozen spans
 * costs one round trip, not twelve. Publishing never throws into the caller.
 *
 * No server-only imports or path aliases, so tests can import it directly
 * (tests/telemetry-events.test.mjs).
 */
import { toTelemetryEvent, type NewTelemetryEvent, type TelemetryEvent } from "./events.ts";

export interface EventLog {
  /** Queues events; resolves once they're written. Never rejects. */
  append(events: NewTelemetryEvent[]): Promise<void>;
  /** Events with seq > cursor, oldest first, plus the current head seq. */
  since(cursor: number, limit?: number): Promise<{ events: TelemetryEvent[]; head: number }>;
  /** The latest seq (0 when empty). */
  head(): Promise<number>;
  /** In-process push for new events (memory log only). Returns an unsubscribe. */
  subscribe?(listener: (events: TelemetryEvent[]) => void): () => void;
}

/** Events kept; a stream that falls further behind skips ahead. */
export const EVENT_LOG_LIMIT = 500;
const BATCH_MS = 50;

const SEQ_KEY = "lufer:telemetry:events:seq";
const LIST_KEY = "lufer:telemetry:events";

/** Batches appends made within `ms` into one `flush`. */
function batcher(flush: (events: NewTelemetryEvent[]) => Promise<void>, ms: number) {
  let pending: NewTelemetryEvent[] = [];
  let scheduled: Promise<void> | null = null;
  return (events: NewTelemetryEvent[]): Promise<void> => {
    if (events.length === 0) return Promise.resolve();
    pending.push(...events);
    scheduled ??= new Promise<void>((resolve) => {
      setTimeout(() => {
        const batch = pending;
        pending = [];
        scheduled = null;
        flush(batch)
          .catch((err) => console.error("telemetry: could not publish events", err))
          .finally(resolve);
      }, ms);
    });
    return scheduled;
  };
}

export function memoryEventLog(limit = EVENT_LOG_LIMIT, batchMs = BATCH_MS): EventLog {
  const events: TelemetryEvent[] = [];
  let seq = 0;
  const listeners = new Set<(events: TelemetryEvent[]) => void>();
  const append = batcher(async (batch) => {
    const numbered = batch.map((e) => ({ ...e, seq: ++seq }) as TelemetryEvent);
    events.push(...numbered);
    if (events.length > limit) events.splice(0, events.length - limit);
    for (const l of listeners) {
      try {
        l(numbered);
      } catch (err) {
        console.error("telemetry: listener failed", err);
      }
    }
  }, batchMs);
  return {
    append,
    async since(cursor, max = limit) {
      return { events: events.filter((e) => e.seq > cursor).slice(0, max), head: seq };
    },
    async head() {
      return seq;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** KEYS: seq, list. ARGV: limit, then one JSON event per arg. Stored as "<seq>|<json>". */
export const APPEND_SCRIPT = `
local seq = 0
for i = 2, #ARGV do
  seq = redis.call('INCR', KEYS[1])
  redis.call('LPUSH', KEYS[2], seq .. '|' .. ARGV[i])
end
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[1]) - 1)
return seq
`;

export interface EventLogRedis {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  get(key: string): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
}

function decode(entry: unknown): TelemetryEvent | null {
  if (typeof entry !== "string") return null;
  const bar = entry.indexOf("|");
  if (bar < 1) return null;
  try {
    return toTelemetryEvent({ ...JSON.parse(entry.slice(bar + 1)), seq: Number(entry.slice(0, bar)) });
  } catch {
    return null;
  }
}

export function redisEventLog(redis: EventLogRedis, limit = EVENT_LOG_LIMIT, batchMs = BATCH_MS): EventLog {
  const head = async () => Number((await redis.get(SEQ_KEY)) ?? 0) || 0;
  return {
    append: batcher(async (batch) => {
      await redis.eval(APPEND_SCRIPT, [SEQ_KEY, LIST_KEY], [String(limit), ...batch.map((e) => JSON.stringify(e))]);
    }, batchMs),
    async since(cursor, max = limit) {
      const h = await head();
      if (h <= cursor) return { events: [], head: h };
      // Newest first in Redis; only the entries past the cursor (bounded by the cap).
      const count = Math.min(h - cursor, limit);
      const raw = await redis.lrange(LIST_KEY, 0, count - 1);
      const events = raw
        .map(decode)
        .filter((e): e is TelemetryEvent => e !== null && e.seq > cursor)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, max);
      return { events, head: h };
    },
    head,
  };
}
