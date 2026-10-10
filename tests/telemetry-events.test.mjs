import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSseEvent, parseCursor, parseTelemetryEvent, SSE_EVENT, sseRetry, toTelemetryEvent, visibleTo } from "../lib/telemetry/events.ts";
import { APPEND_SCRIPT, memoryEventLog, redisEventLog } from "../lib/telemetry/event-log.ts";
import { memoryTraceStore, Tracer } from "../lib/tracer.ts";

const span = (over = {}) => ({ spanId: "s1", parentId: null, name: "api.chat", start: 1000, durationMs: 42, status: "ok", ...over });
const run = (over = {}) => ({
  id: "r1",
  agent: "workspace-agent",
  at: "2026-10-10T10:00:00.000Z",
  ok: true,
  task: "Chat: hello",
  durationMs: 900,
  source: "chat",
  channel: "web",
  tokens: 120,
  steps: 2,
  ...over,
});
const EVENTS = {
  span: { seq: 1, at: 5, type: "span", traceId: "t1", root: false, span: span({ parentId: "p1" }) },
  trace: { seq: 2, at: 6, type: "trace", traceId: "t1", name: "api.chat", status: "error", durationMs: 1200, spans: 4 },
  run: { seq: 3, at: 7, type: "run", run: run({ ok: false, error: "timeout" }) },
  sync: { seq: 4, at: 8, type: "venue-sync", total: 42, partners: { network: "Mock partners", status: "ok", count: 12 } },
};

// ----------------------------------------------------------------------------
// Parser
// ----------------------------------------------------------------------------

test("parseTelemetryEvent accepts every event type unchanged", () => {
  for (const e of Object.values(EVENTS)) assert.deepEqual(parseTelemetryEvent(JSON.stringify(e)), e);
  const down = { ...EVENTS.sync, partners: { network: "Feed", status: "unavailable", error: "timeout" } };
  assert.deepEqual(parseTelemetryEvent(JSON.stringify(down)), down);
  const failedSpan = { ...EVENTS.span, span: span({ status: "error", error: { name: "Error", message: "boom" } }) };
  assert.deepEqual(parseTelemetryEvent(JSON.stringify(failedSpan)), failedSpan);
});

test("parseTelemetryEvent rejects bad JSON, unknown types and missing or wrong fields", () => {
  for (const data of ["", "not json", "null", "[]", "42", JSON.stringify({ ...EVENTS.trace, type: "bogus" })]) {
    assert.equal(parseTelemetryEvent(data), null, data);
  }
  const bad = [
    { ...EVENTS.trace, seq: 0 },
    { ...EVENTS.trace, seq: 1.5 },
    { ...EVENTS.trace, seq: "2" },
    { ...EVENTS.trace, at: undefined },
    { ...EVENTS.trace, status: "pending" },
    { ...EVENTS.trace, durationMs: Infinity },
    { ...EVENTS.span, root: "yes" },
    { ...EVENTS.span, span: span({ parentId: 3 }) },
    { ...EVENTS.span, span: span({ error: { name: "Error" } }) },
    { ...EVENTS.run, run: run({ ok: "true" }) },
    { ...EVENTS.run, run: run({ error: 5 }) },
    { ...EVENTS.sync, partners: { network: "x", status: "ok" } },
    { ...EVENTS.trace, traceId: "x".repeat(65) },
  ];
  for (const e of bad) assert.equal(toTelemetryEvent(e), null, JSON.stringify(e));
});

test("parsed events drop unknown extra fields", () => {
  const e = parseTelemetryEvent(JSON.stringify({ ...EVENTS.run, secret: "x", run: { ...EVENTS.run.run, extra: 1 } }));
  assert.equal("secret" in e, false);
  assert.equal("extra" in e.run, false);
});

// ----------------------------------------------------------------------------
// SSE encoding
// ----------------------------------------------------------------------------

test("encodeSseEvent writes id, event name and one data line that parses back", () => {
  const frame = encodeSseEvent(EVENTS.span);
  assert.ok(frame.endsWith("\n\n"));
  const lines = frame.trimEnd().split("\n");
  assert.deepEqual(lines.slice(0, 2), ["id: 1", `event: ${SSE_EVENT}`]);
  assert.equal(lines.length, 3);
  assert.deepEqual(parseTelemetryEvent(lines[2].slice("data: ".length)), EVENTS.span);
  // Newlines inside strings are escaped by JSON, so a message can't be split or injected.
  const sneaky = { ...EVENTS.run, run: run({ task: "a\n\nevent: x\ndata: y" }) };
  assert.equal(encodeSseEvent(sneaky).trimEnd().split("\n").length, 3);
  assert.equal(sseRetry(2000.4), "retry: 2000\n\n");
});

test("parseCursor accepts non-negative integers only", () => {
  assert.equal(parseCursor("42"), 42);
  assert.equal(parseCursor(" 7 "), 7);
  for (const v of [null, undefined, "", "-1", "1.5", "abc", "1e3", "9".repeat(16)]) assert.equal(parseCursor(v), null, String(v));
});

test("visibleTo: operator events need ops; venue syncs need venues", () => {
  const ops = { ops: true, venues: false };
  const booker = { ops: false, venues: true };
  assert.deepEqual(Object.values(EVENTS).map((e) => visibleTo(e, ops)), [true, true, true, false]);
  assert.deepEqual(Object.values(EVENTS).map((e) => visibleTo(e, booker)), [false, false, false, true]);
});

// ----------------------------------------------------------------------------
// Event log
// ----------------------------------------------------------------------------

/** An event as published, before the log numbers it. */
const strip = (e) => {
  const copy = { ...e };
  delete copy.seq;
  return copy;
};

test("memory log numbers events in order, batches appends and serves since(cursor)", async () => {
  const log = memoryEventLog(100, 0);
  const heard = [];
  const off = log.subscribe((events) => heard.push(events.map((e) => e.seq)));
  await Promise.all([log.append([strip(EVENTS.span)]), log.append([strip(EVENTS.trace), strip(EVENTS.run)])]);
  assert.equal(await log.head(), 3);
  assert.deepEqual(heard, [[1, 2, 3]]); // one batch
  assert.deepEqual((await log.since(1)).events.map((e) => e.type), ["trace", "run"]);
  assert.deepEqual((await log.since(0, 2)).events.map((e) => e.seq), [1, 2]);
  assert.deepEqual(await log.since(3), { events: [], head: 3 });
  off();
  await log.append([strip(EVENTS.sync)]);
  assert.equal(heard.length, 1);
  await log.append([]);
  assert.equal(await log.head(), 4);
});

test("memory log keeps only the newest events", async () => {
  const log = memoryEventLog(3, 0);
  await log.append([1, 2, 3, 4, 5].map((at) => ({ ...strip(EVENTS.trace), at })));
  const { events, head } = await log.since(0);
  assert.equal(head, 5);
  assert.deepEqual(events.map((e) => e.seq), [3, 4, 5]);
});

/** A Redis double that runs APPEND_SCRIPT's logic. */
function fakeRedis() {
  const kv = new Map();
  const lists = new Map();
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async eval(script, [seqKey, listKey], [limit, ...items]) {
      calls++;
      assert.equal(script, APPEND_SCRIPT);
      const list = lists.get(listKey) ?? [];
      let seq = 0;
      for (const item of items) {
        seq = (kv.get(seqKey) ?? 0) + 1;
        kv.set(seqKey, seq);
        list.unshift(`${seq}|${item}`);
      }
      lists.set(listKey, list.slice(0, Number(limit)));
      return seq;
    },
    async get(key) {
      calls++;
      return kv.get(key) ?? null;
    },
    async lrange(key, start, stop) {
      calls++;
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
  };
}

test("redis log: one script call per batch, ordered reads past the cursor, cheap idle polls", async () => {
  const redis = fakeRedis();
  const log = redisEventLog(redis, 100, 0);
  await Promise.all([log.append([strip(EVENTS.span), strip(EVENTS.trace)]), log.append([strip(EVENTS.run)])]);
  assert.equal(redis.calls, 1);
  const { events, head } = await log.since(1);
  assert.equal(head, 3);
  assert.deepEqual(events, [EVENTS.trace, EVENTS.run].map((e, i) => ({ ...e, seq: i + 2 })));
  const before = redis.calls;
  assert.deepEqual(await log.since(3), { events: [], head: 3 });
  assert.equal(redis.calls - before, 1); // just the head GET
});

test("redis log skips corrupt entries and respects the cap", async () => {
  const redis = fakeRedis();
  const log = redisEventLog(redis, 2, 0);
  await log.append([1, 2, 3].map((at) => ({ ...strip(EVENTS.trace), at })));
  assert.deepEqual((await log.since(0)).events.map((e) => e.seq), [2, 3]);
  await redis.eval(APPEND_SCRIPT, ["lufer:telemetry:events:seq", "lufer:telemetry:events"], ["5", "{not json"]);
  assert.deepEqual((await log.since(3)).events, []);
});

test("a failing store never rejects append", async () => {
  const log = redisEventLog({ eval: () => Promise.reject(new Error("down")), get: async () => 0, lrange: async () => [] }, 10, 0);
  const error = console.error;
  console.error = () => {};
  try {
    await log.append([strip(EVENTS.trace)]);
  } finally {
    console.error = error;
  }
});

// ----------------------------------------------------------------------------
// Tracer → live events
// ----------------------------------------------------------------------------

function tracerWith(over = {}) {
  let t = 0;
  let n = 0;
  const events = [];
  const tracer = new Tracer({ store: memoryTraceStore(), now: () => 1000 + t, clock: () => t, id: () => `id${++n}`, random: () => 0.5, onEvent: (e) => events.push(e), ...over });
  return { tracer, events, tick: (ms) => (t += ms) };
}

test("tracer emits each span as it ends, root last, then the stored trace", async () => {
  const { tracer, events, tick } = tracerWith();
  await tracer.trace("api.chat", async () => {
    await tracer.trace("db.query", async () => tick(10));
    await tracer.trace("llm.stream", async () => tick(30));
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events.map((e) => (e.type === "span" ? `${e.span.name}${e.root ? "*" : ""}` : `trace:${e.trace.name}`)), ["db.query", "llm.stream", "api.chat*", "trace:api.chat"]);
  const traceId = events[0].traceId;
  assert.ok(events.slice(0, 3).every((e) => e.traceId === traceId));
  assert.equal(events[3].trace.traceId, traceId);
});

test("tracer: a sampled-out trace streams spans but no stored-trace event; listener errors are contained", async () => {
  const { tracer, events } = tracerWith({ sampleRate: 0 });
  await tracer.trace("api.ok", async () => {});
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events.map((e) => e.type), ["span"]);

  const error = console.error;
  console.error = () => {};
  try {
    const { tracer: t2 } = tracerWith({ onEvent: () => { throw new Error("listener"); } });
    assert.equal(await t2.trace("api.x", async () => "still works"), "still works");
  } finally {
    console.error = error;
  }
});
