import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSseEvent, SSE_EVENT } from "../lib/telemetry/events.ts";
import { connectTelemetryStream } from "../lib/telemetry/stream-client.ts";
import {
  BUFFER_LIMIT,
  INITIAL_STREAM,
  latestVenueSync,
  liveRunsFor,
  liveTrace,
  refreshSeqFor,
  telemetryStreamReducer,
} from "../lib/telemetry/stream-state.ts";

const spanEv = (seq, traceId, spanId, over = {}, root = false) => ({
  seq,
  at: seq,
  type: "span",
  traceId,
  root,
  span: { spanId, parentId: root ? null : "root", name: `op.${spanId}`, start: 1000 + seq, durationMs: 5, status: "ok", ...over },
});
const traceEv = (seq, traceId) => ({ seq, at: seq, type: "trace", traceId, name: "api.chat", status: "ok", durationMs: 50, spans: 3 });
const runEv = (seq, agent) => ({
  seq,
  at: seq,
  type: "run",
  run: { id: `r${seq}`, agent, at: "2026-10-10T10:00:00.000Z", ok: true, task: "t", durationMs: 1, source: "chat", channel: "web", tokens: 0, steps: 1 },
});
const syncEv = (seq, total) => ({ seq, at: seq, type: "venue-sync", total, partners: { network: "P", status: "ok", count: 1 } });

const reduce = (actions, from = INITIAL_STREAM) => actions.reduce(telemetryStreamReducer, from);

// ----------------------------------------------------------------------------
// Reducer
// ----------------------------------------------------------------------------

test("status: idle → connecting → live → reconnecting → live, and unavailable when refused", () => {
  const seen = [];
  let s = INITIAL_STREAM;
  for (const a of [{ type: "connecting" }, { type: "open" }, { type: "error", retrying: true }, { type: "open" }, { type: "error", retrying: false }, { type: "stop" }]) {
    s = telemetryStreamReducer(s, a);
    seen.push(s.status);
  }
  assert.deepEqual(seen, ["connecting", "live", "reconnecting", "live", "unavailable", "idle"]);
});

test("reconnecting after a stop/hidden tab: a second connect from live reports reconnecting", () => {
  assert.equal(reduce([{ type: "connecting" }, { type: "open" }, { type: "connecting" }]).status, "reconnecting");
  assert.equal(reduce([{ type: "error", retrying: false }, { type: "connecting" }]).status, "connecting");
});

test("events are appended in seq order, deduped, and mark the stream live", () => {
  const s = reduce([
    { type: "connecting" },
    { type: "events", events: [runEv(3, "a"), runEv(1, "a"), runEv(3, "a")], receivedAt: 100 },
    { type: "events", events: [runEv(2, "a"), runEv(4, "a")], receivedAt: 200 },
  ]);
  assert.equal(s.status, "live");
  assert.deepEqual(s.events.map((e) => e.seq), [1, 3, 4]); // 2 arrived after 3: a replay, dropped
  assert.equal(s.lastSeq, 4);
  assert.equal(s.lastEventAt, 200);
});

test("no-op actions keep the same state object", () => {
  const s = reduce([{ type: "connecting" }, { type: "open" }, { type: "events", events: [runEv(1, "a")], receivedAt: 1 }]);
  assert.equal(telemetryStreamReducer(s, { type: "open" }), s);
  assert.equal(telemetryStreamReducer(s, { type: "events", events: [runEv(1, "a")], receivedAt: 2 }), s);
  assert.equal(telemetryStreamReducer(s, { type: "events", events: [], receivedAt: 2 }), s);
  assert.equal(telemetryStreamReducer(INITIAL_STREAM, { type: "stop" }), INITIAL_STREAM);
});

test("the buffer keeps the newest BUFFER_LIMIT events", () => {
  const events = Array.from({ length: BUFFER_LIMIT + 25 }, (_, i) => runEv(i + 1, "a"));
  const s = reduce([{ type: "events", events, receivedAt: 1 }]);
  assert.equal(s.events.length, BUFFER_LIMIT);
  assert.equal(s.events[0].seq, 26);
  assert.equal(s.lastSeq, BUFFER_LIMIT + 25);
});

// ----------------------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------------------

test("liveTrace: running, then ended with root status, then stored", () => {
  const running = [spanEv(1, "t1", "a"), spanEv(2, "t2", "x"), spanEv(3, "t1", "b", { status: "error", error: { name: "Error", message: "boom" } })];
  const lt = liveTrace(running, "t1");
  assert.equal(lt.status, "running");
  assert.equal(lt.ended, false);
  assert.deepEqual(lt.spans.map((s) => s.spanId), ["a", "b"]);
  assert.equal(lt.name, "op.a");

  const ended = [...running, spanEv(4, "t1", "root", { start: 900, name: "api.chat" }, true), spanEv(5, "t1", "a", { start: 1001 })];
  const done = liveTrace(ended, "t1");
  assert.equal(done.ended, true);
  assert.equal(done.status, "error");
  assert.equal(done.name, "api.chat");
  assert.deepEqual(done.spans.map((s) => s.spanId), ["root", "a", "b"]); // start order, deduped
  assert.equal(done.storedSeq, null);
  assert.equal(liveTrace([...ended, traceEv(6, "t1")], "t1").storedSeq, 6);

  assert.equal(liveTrace(running, "nope"), null);
});

test("liveRunsFor, latestVenueSync and refreshSeqFor", () => {
  const events = [runEv(1, "a"), syncEv(2, 10), runEv(3, "b"), runEv(4, "a"), traceEv(5, "t1"), syncEv(6, 11)];
  assert.deepEqual(liveRunsFor(events, "a").map((r) => r.id), ["r4", "r1"]);
  assert.equal(latestVenueSync(events).total, 11);
  assert.equal(latestVenueSync([runEv(1, "a")]), null);
  assert.equal(refreshSeqFor(events, "agent", "a"), 4);
  assert.equal(refreshSeqFor(events, "agent", "zzz"), 0);
  assert.equal(refreshSeqFor(events, "trace", "t1"), 5);
  assert.equal(refreshSeqFor(events, "venue", "any-venue"), 6);
  assert.equal(refreshSeqFor(events, "run", "r1"), 0);
});

// ----------------------------------------------------------------------------
// connectTelemetryStream (the hook's connection logic) with a fake EventSource
// ----------------------------------------------------------------------------

class FakeEventSource {
  static last = null;
  readyState = 0;
  onopen = null;
  onerror = null;
  closed = false;
  listeners = new Map();
  constructor(url) {
    this.url = url;
    FakeEventSource.last = this;
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  // Test helpers.
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  /** Delivers an encoded SSE frame the way a browser would: the data line's payload. */
  frame(event) {
    const data = encodeSseEvent(event).split("\n").find((l) => l.startsWith("data: ")).slice(6);
    this.listeners.get(SSE_EVENT)?.({ data });
  }
  raw(data) {
    this.listeners.get(SSE_EVENT)?.({ data });
  }
  fail(readyState) {
    this.readyState = readyState;
    this.onerror?.({});
  }
}

function harness(opts = {}) {
  const actions = [];
  const timers = [];
  const close = connectTelemetryStream((url) => new FakeEventSource(url), (a) => actions.push(a), {
    url: "/api/telemetry/stream",
    now: () => 777,
    setTimer: (fn) => (timers.push(fn), timers.length),
    clearTimer: () => {},
    ...opts,
  });
  return { es: FakeEventSource.last, actions, close, runTimers: () => timers.splice(0).forEach((f) => f()) };
}

test("connect: dispatches connecting, open, batched events and errors", () => {
  const { es, actions, runTimers } = harness();
  assert.equal(es.url, "/api/telemetry/stream");
  es.open();
  es.frame(runEv(1, "a"));
  es.raw("garbage");
  es.frame(runEv(2, "a"));
  assert.deepEqual(actions.map((a) => a.type), ["connecting", "open"]); // events wait for the batch timer
  runTimers();
  assert.deepEqual(actions.at(-1), { type: "events", events: [runEv(1, "a"), runEv(2, "a")], receivedAt: 777 });
  es.fail(0);
  es.fail(2);
  assert.deepEqual(actions.slice(-2), [{ type: "error", retrying: true }, { type: "error", retrying: false }]);
});

test("connect: resumes after `since`, and closing flushes pending events and stops the source", () => {
  const { es, actions, close } = harness({ since: 41 });
  assert.equal(es.url, "/api/telemetry/stream?since=41");
  es.frame(runEv(42, "a"));
  close();
  assert.equal(es.closed, true);
  assert.equal(es.onopen, null);
  assert.deepEqual(actions.at(-1).events.map((e) => e.seq), [42]);
});

test("end to end: frames through connect into the reducer", () => {
  const { es, actions, runTimers } = harness();
  es.open();
  es.frame(spanEv(1, "t1", "a"));
  es.frame(spanEv(2, "t1", "root", {}, true));
  es.frame(traceEv(3, "t1"));
  runTimers();
  const state = reduce(actions);
  assert.equal(state.status, "live");
  const lt = liveTrace(state.events, "t1");
  assert.equal(lt.ended, true);
  assert.equal(lt.storedSeq, 3);
  assert.equal(refreshSeqFor(state.events, "trace", "t1"), 3);
});
