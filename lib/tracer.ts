/**
 * Structured APM tracing backed by Upstash Redis.
 *
 *   await tracer.trace("chat.request", async (span) => {
 *     span.setAttributes({ role: member.role, messages: messages.length });
 *     const venues = await tracer.trace("db.listVenues", () => listVenues());
 *     return tracer.trace("llm.stream", () => streamText(…), { attributes: { model } });
 *   });
 *
 *   export const searchVenues = tracer.wrap("tool.searchVenues", searchVenuesImpl, { captureArgs: true });
 *
 * - `trace()` starts a root trace, or a child span when one is already active:
 *   context flows through `await` via AsyncLocalStorage, so nesting is automatic.
 * - Each span records start time, duration (monotonic clock), status, error and
 *   attributes. Arguments and metadata are sanitized before storage: secret-looking
 *   keys and values are redacted, emails masked, and strings, arrays, depth and
 *   attribute counts capped.
 * - When the root span ends, the whole trace is written in one pipelined request:
 *   a capped list `lufer:traces` (newest first) for the dashboard, plus
 *   `lufer:trace:<id>` (7-day TTL) for lookup by id. Writes are handed to Next's
 *   `after()` when inside a request and never throw into the caller.
 * - Sampling happens at the end of the trace: errors are always kept, successes
 *   with probability `sampleRate`.
 * - Without UPSTASH_REDIS_REST_URL / _TOKEN, traces are kept in process memory.
 *
 * No server-only imports or path aliases, so tests can import it directly
 * (tests/tracer.test.mjs). Node.js runtime only (node:async_hooks).
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { Redis } from "@upstash/redis";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };
export type Attributes = Record<string, AttributeValue>;
export type SpanStatus = "ok" | "error";

export interface SpanRecord {
  spanId: string;
  parentId: string | null;
  name: string;
  /** Epoch ms. */
  start: number;
  durationMs: number;
  status: SpanStatus;
  error?: { name: string; message: string };
  attributes: Attributes;
}

export interface TraceRecord {
  traceId: string;
  /** The root span's name. */
  name: string;
  start: number;
  durationMs: number;
  status: SpanStatus;
  /** Spans recorded, root first then in start order. */
  spans: SpanRecord[];
  /** Spans dropped by the per-trace limit or size cap. */
  droppedSpans: number;
}

/** What a traced function can do with its own span. */
export interface ActiveSpan {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;
  /** Mark the span failed without throwing (e.g. a handled upstream error). */
  recordError(error: unknown): void;
}

/** A span ended explicitly, for work that outlives the function that starts it (streams, callbacks). */
export interface ManualSpan extends ActiveSpan {
  /** Ends the span (idempotent). */
  end(): void;
  /** Runs `fn` with this span as the active parent, so spans started inside are its children. */
  run<T>(fn: () => T): T;
}

export interface TraceOptions {
  attributes?: Record<string, unknown>;
  /** Start a new root trace even if a span is active. */
  root?: boolean;
}

export interface TraceStore {
  save(trace: TraceRecord): Promise<void>;
  list(limit: number): Promise<TraceRecord[]>;
  get(traceId: string): Promise<TraceRecord | null>;
}

export interface TracerOptions {
  store: TraceStore;
  /** Fraction of successful traces kept (errors are always kept). Default 1. */
  sampleRate?: number;
  /** Spans kept per trace. Default 200. */
  maxSpansPerTrace?: number;
  /** Serialized size cap per trace in bytes. Default 64 KiB. */
  maxTraceBytes?: number;
  /** Hand a background write to the platform (Next's after()). Default: let it run. */
  defer?: (work: Promise<void>) => void;
  /** Injectable for tests. */
  now?: () => number;
  clock?: () => number;
  random?: () => number;
  id?: () => string;
}

// ----------------------------------------------------------------------------
// Sanitizing captured metadata and arguments
// ----------------------------------------------------------------------------

const LIMITS = { string: 500, array: 20, keys: 32, depth: 4 };
// "token" only at the end of a key: accessToken / x-token are secrets, tokens / totalTokens are counts.
const SECRET_KEY = /pass(word|wd)?|secret|token$|api[-_]?key|^auth$|authorization|cookie|session|credential|private[-_]?key|signature|cvv|card[-_]?number|otp/i;
const SECRET_VALUE = /^(sk-|sk_live_|sk_test_|rk_live_|sb_secret_|sb_publishable_|xox[abpr]-|ghp_|github_pat_|eyJ[A-Za-z0-9_-]{10,}\.|Bearer\s)/;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

function cleanString(s: string): string {
  if (SECRET_VALUE.test(s.trim())) return "[redacted]";
  const masked = s.replace(EMAIL, "$1***@$2");
  return masked.length > LIMITS.string ? `${masked.slice(0, LIMITS.string)}…[+${masked.length - LIMITS.string}]` : masked;
}

/** JSON-safe, redacted, size-capped copy of any value. Exported for tests. */
export function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): AttributeValue {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
      return cleanString(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
      return `[function ${value.name || "anonymous"}]`;
    case "symbol":
      return value.toString();
  }
  const obj = value as object;
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString();
  if (obj instanceof Error) return { name: obj.name, message: cleanString(obj.message) };
  if (obj instanceof URL) return cleanString(obj.origin + obj.pathname);
  if (seen.has(obj)) return "[circular]";
  if (depth >= LIMITS.depth) return Array.isArray(obj) ? `[array(${obj.length})]` : "[object]";
  seen.add(obj);
  if (Array.isArray(obj)) {
    const items = obj.slice(0, LIMITS.array).map((v) => sanitize(v, depth + 1, seen));
    if (obj.length > LIMITS.array) items.push(`…[+${obj.length - LIMITS.array}]`);
    return items;
  }
  if (obj instanceof Map) return sanitize(Object.fromEntries(obj), depth, seen);
  if (obj instanceof Set) return sanitize([...obj], depth, seen);
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return `[binary ${(obj as ArrayBuffer).byteLength} bytes]`;
  if (typeof (obj as { getReader?: unknown }).getReader === "function") return "[stream]";

  const out: Record<string, AttributeValue> = {};
  const entries = Object.entries(obj);
  for (const [k, v] of entries.slice(0, LIMITS.keys)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1, seen);
  if (entries.length > LIMITS.keys) out["…"] = `+${entries.length - LIMITS.keys} keys`;
  return out;
}

const errorInfo = (e: unknown): { name: string; message: string } =>
  e instanceof Error
    ? { name: e.name, message: cleanString(e.message) }
    : { name: "Error", message: cleanString(typeof e === "string" ? e : JSON.stringify(sanitize(e))) };

// ----------------------------------------------------------------------------
// Tracer
// ----------------------------------------------------------------------------

interface TraceBuffer {
  traceId: string;
  spans: SpanRecord[];
  dropped: number;
  done: boolean;
}

interface SpanContext {
  buffer: TraceBuffer;
  spanId: string;
  span: ActiveSpan;
}

export class Tracer {
  private readonly als = new AsyncLocalStorage<SpanContext>();
  private readonly o: Required<Omit<TracerOptions, "defer">> & Pick<TracerOptions, "defer">;

  constructor(options: TracerOptions) {
    this.o = {
      sampleRate: 1,
      maxSpansPerTrace: 200,
      maxTraceBytes: 64 * 1024,
      now: Date.now,
      clock: () => performance.now(),
      random: Math.random,
      id: () => crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      ...options,
    };
  }

  /** The span the current code is running in, if any. */
  currentSpan(): { traceId: string; spanId: string } | undefined {
    const ctx = this.als.getStore();
    return ctx ? { traceId: ctx.buffer.traceId, spanId: ctx.spanId } : undefined;
  }

  /** Adds attributes to the active span, if any (no-op outside a trace). */
  annotate(attributes: Record<string, unknown>) {
    this.als.getStore()?.span.setAttributes(attributes);
  }

  /**
   * Runs `fn` in a span: a child of the active span, or a new root trace. The
   * span ends when `fn` settles; a throw is recorded and re-thrown unchanged.
   */
  async trace<T>(name: string, fn: (span: ActiveSpan) => T | Promise<T>, options: TraceOptions = {}): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      return await span.run(() => fn(span));
    } catch (error) {
      span.recordError(error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Starts a span you end yourself: a child of the active span, or a new root.
   * For work that finishes in a callback, e.g. a model stream's onEnd.
   */
  startSpan(name: string, options: TraceOptions = {}): ManualSpan {
    const parent = options.root ? undefined : this.als.getStore();
    const buffer: TraceBuffer = parent?.buffer ?? { traceId: this.o.id() + this.o.id(), spans: [], dropped: 0, done: false };
    const record: SpanRecord = {
      spanId: this.o.id(),
      parentId: parent?.spanId ?? null,
      name,
      start: this.o.now(),
      durationMs: 0,
      status: "ok",
      attributes: {},
    };
    const t0 = this.o.clock();
    const handle = this.handle(buffer.traceId, record);
    const ctx: SpanContext = { buffer, spanId: record.spanId, span: handle };
    let ended = false;
    const span: ManualSpan = {
      ...handle,
      run: (fn) => this.als.run(ctx, fn),
      end: () => {
        if (ended) return;
        ended = true;
        record.durationMs = Math.round((this.o.clock() - t0) * 100) / 100;
        this.end(buffer, record, !parent);
      },
    };
    if (options.attributes) span.setAttributes(options.attributes);
    return span;
  }

  /**
   * Traces an HTTP handler as a root trace. The span stays open until a
   * streamed body has been fully sent (or the client disconnects), so model
   * streams and tool calls made while streaming land in the same trace. Records
   * `http.status`; a 5xx or a stream error marks it failed, a disconnect sets
   * `http.cancelled`.
   */
  traceResponse<A extends unknown[]>(
    name: string,
    handler: (...args: A) => Response | Promise<Response>,
    attributes: (...args: A) => Record<string, unknown> = () => ({})
  ): (...args: A) => Promise<Response> {
    return async (...args: A) => {
      const span = this.startSpan(name, { root: true, attributes: attributes(...args) });
      let res: Response;
      try {
        res = await span.run(() => handler(...args));
      } catch (error) {
        span.recordError(error);
        span.end();
        throw error;
      }
      span.setAttribute("http.status", res.status);
      if (res.status >= 500) span.recordError(new Error(`HTTP ${res.status}`));
      if (!res.body) {
        span.end();
        return res;
      }
      const reader = res.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              span.end();
              controller.close();
            } else controller.enqueue(value);
          } catch (error) {
            span.recordError(error);
            span.end();
            controller.error(error);
          }
        },
        async cancel(reason) {
          span.setAttribute("http.cancelled", true);
          span.end();
          await reader.cancel(reason);
        },
      });
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    };
  }

  /**
   * A traced version of `fn`. With `captureArgs`, the (sanitized) arguments are
   * recorded as the `args` attribute.
   */
  wrap<A extends unknown[], R>(
    name: string,
    fn: (...args: A) => R | Promise<R>,
    options: { captureArgs?: boolean; attributes?: Record<string, unknown> } = {}
  ): (...args: A) => Promise<R> {
    return (...args: A) =>
      this.trace(name, () => fn(...args), {
        attributes: { ...options.attributes, ...(options.captureArgs ? { args } : {}) },
      });
  }

  // --- reading, for /admin/analytics ----------------------------------------

  /** Most recent traces first, optionally filtered. */
  async listTraces(filter: { limit?: number; name?: string; status?: SpanStatus } = {}): Promise<TraceRecord[]> {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const filtered = Boolean(filter.name || filter.status);
    const traces = await this.o.store.list(filtered ? 1000 : limit);
    return traces.filter((t) => (!filter.name || t.name === filter.name) && (!filter.status || t.status === filter.status)).slice(0, limit);
  }

  getTrace(traceId: string): Promise<TraceRecord | null> {
    return this.o.store.get(traceId);
  }

  // --------------------------------------------------------------------------

  private handle(traceId: string, record: SpanRecord): ActiveSpan {
    const set = (key: string, value: unknown) => {
      if (key in record.attributes || Object.keys(record.attributes).length < LIMITS.keys) {
        record.attributes[key] = SECRET_KEY.test(key) ? "[redacted]" : sanitize(value);
      }
    };
    return {
      traceId,
      spanId: record.spanId,
      setAttribute: set,
      setAttributes: (attrs) => Object.entries(attrs).forEach(([k, v]) => set(k, v)),
      recordError: (error) => {
        record.status = "error";
        record.error = errorInfo(error);
      },
    };
  }

  private end(buffer: TraceBuffer, record: SpanRecord, isRoot: boolean) {
    // A child that outlives its root (fire-and-forget work) can't join a trace that's already written.
    if (buffer.done) return;
    if (isRoot || buffer.spans.length < this.o.maxSpansPerTrace - 1) buffer.spans.push(record);
    else buffer.dropped++;
    if (!isRoot) return;

    buffer.done = true;
    if (record.status === "ok" && this.o.random() >= this.o.sampleRate) return;
    const trace = this.assemble(buffer, record);
    const work = this.o.store.save(trace).catch((err) => console.error("tracer: could not store trace", err));
    this.o.defer?.(work);
  }

  private assemble(buffer: TraceBuffer, root: SpanRecord): TraceRecord {
    const children = buffer.spans.filter((s) => s !== root).sort((a, b) => a.start - b.start);
    const trace: TraceRecord = {
      traceId: buffer.traceId,
      name: root.name,
      start: root.start,
      durationMs: root.durationMs,
      // A trace is failed if any span failed, even one the root caught.
      status: buffer.spans.some((s) => s.status === "error") ? "error" : "ok",
      spans: [root, ...children],
      droppedSpans: buffer.dropped,
    };
    // Size cap: drop child attributes first, then the latest children.
    const size = () => Buffer.byteLength(JSON.stringify(trace));
    if (size() > this.o.maxTraceBytes) trace.spans = trace.spans.map((s, i) => (i === 0 ? s : { ...s, attributes: {} }));
    while (trace.spans.length > 1 && size() > this.o.maxTraceBytes) {
      trace.spans.pop();
      trace.droppedSpans++;
    }
    return trace;
  }
}

// ----------------------------------------------------------------------------
// Aggregates for the dashboard
// ----------------------------------------------------------------------------

export interface SpanStats {
  name: string;
  count: number;
  errors: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** Per-span-name latency and error stats over the given traces, slowest p95 first. */
export function spanStats(traces: TraceRecord[], options: { since?: number } = {}): SpanStats[] {
  const groups = new Map<string, SpanRecord[]>();
  for (const t of traces) {
    if (options.since && t.start < options.since) continue;
    for (const s of t.spans) groups.set(s.name, [...(groups.get(s.name) ?? []), s]);
  }
  return [...groups]
    .map(([name, spans]) => {
      const d = spans.map((s) => s.durationMs).sort((a, b) => a - b);
      return {
        name,
        count: spans.length,
        errors: spans.filter((s) => s.status === "error").length,
        avgMs: Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 100) / 100,
        p50Ms: pct(d, 50),
        p95Ms: pct(d, 95),
        maxMs: d[d.length - 1],
      };
    })
    .sort((a, b) => b.p95Ms - a.p95Ms);
}

export interface TraceSummary {
  /** Traces in the period. */
  traces: number;
  /** Root spans (routes, webhooks, workflow steps) by name, slowest p95 first. */
  routes: SpanStats[];
  /** Non-root spans (model calls, tools, DB work) by name, slowest p95 first. */
  operations: SpanStats[];
  /** Most recent failed traces, newest first. */
  failures: TraceRecord[];
  /** Oldest trace held, when the list is full: older traces in the period were trimmed. */
  trimmedBefore: number | null;
}

/** What /admin/analytics shows for traces started at or after `since`. */
export function summarizeTraces(all: TraceRecord[], since: number, options: { listLimit?: number; failures?: number } = {}): TraceSummary {
  const traces = all.filter((t) => t.start >= since);
  // A request counts as failed if anything in it failed, even when the route recovered.
  const roots = traces.map((t) => ({ ...t, spans: t.spans.slice(0, 1).map((r) => ({ ...r, status: t.status })) }));
  const children = traces.map((t) => ({ ...t, spans: t.spans.slice(1) }));
  const oldest = all.length ? Math.min(...all.map((t) => t.start)) : null;
  return {
    traces: traces.length,
    routes: spanStats(roots),
    operations: spanStats(children),
    failures: traces
      .filter((t) => t.status === "error")
      .sort((a, b) => b.start - a.start)
      .slice(0, options.failures ?? 5),
    trimmedBefore: all.length >= (options.listLimit ?? TRACE_LIST_LIMIT) && oldest !== null && oldest > since ? oldest : null,
  };
}

// ----------------------------------------------------------------------------
// Stores
// ----------------------------------------------------------------------------

const LIST_KEY = "lufer:traces";
const TRACE_KEY = (id: string) => `lufer:trace:${id}`;
/** Traces kept in the list the dashboard reads. */
export const TRACE_LIST_LIMIT = 500;
const TRACE_TTL_SECONDS = 7 * 24 * 3600;

const parse = (v: unknown): TraceRecord => (typeof v === "string" ? JSON.parse(v) : v) as TraceRecord;

export function redisTraceStore(redis: Pick<Redis, "pipeline" | "lrange" | "get">, limit = TRACE_LIST_LIMIT): TraceStore {
  return {
    async save(trace) {
      const json = JSON.stringify(trace);
      await redis.pipeline().lpush(LIST_KEY, json).ltrim(LIST_KEY, 0, limit - 1).set(TRACE_KEY(trace.traceId), json, { ex: TRACE_TTL_SECONDS }).exec();
    },
    async list(n) {
      return (await redis.lrange<unknown>(LIST_KEY, 0, Math.min(n, limit) - 1)).map(parse);
    },
    async get(id) {
      const v = await redis.get<unknown>(TRACE_KEY(id));
      return v ? parse(v) : null;
    },
  };
}

export function memoryTraceStore(limit = TRACE_LIST_LIMIT): TraceStore {
  const traces: TraceRecord[] = [];
  return {
    async save(trace) {
      traces.unshift(structuredClone(trace));
      traces.length = Math.min(traces.length, limit);
    },
    async list(n) {
      return traces.slice(0, n).map((t) => structuredClone(t));
    },
    async get(id) {
      const t = traces.find((x) => x.traceId === id);
      return t ? structuredClone(t) : null;
    },
  };
}

// ----------------------------------------------------------------------------
// The app's tracer
// ----------------------------------------------------------------------------

/** Next's after() when inside a request, so writes finish after the response is sent. */
function deferToNext(work: Promise<void>) {
  import("next/server")
    .then(({ after }) => after(work))
    .catch(() => {
      // Outside a request (scripts, tests): the write still runs.
    });
}

function createAppTracer(): Tracer {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const rate = Number(process.env.TRACE_SAMPLE_RATE);
  return new Tracer({
    store: url && token ? redisTraceStore(new Redis({ url, token })) : memoryTraceStore(),
    sampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1,
    defer: deferToNext,
  });
}

const g = globalThis as typeof globalThis & { __luferTracer?: Tracer };

/** Shared tracer (kept on globalThis so `next dev` reloads keep one AsyncLocalStorage and memory store). */
export const tracer: Tracer = (g.__luferTracer ??= createAppTracer());
