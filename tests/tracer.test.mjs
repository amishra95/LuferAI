import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryTraceStore, redisTraceStore, sanitize, spanStats, Tracer } from "../lib/tracer.ts";

function setup(over = {}) {
  let t = 0;
  let n = 0;
  const store = memoryTraceStore();
  const tracer = new Tracer({ store, now: () => 1_000 + t, clock: () => t, id: () => `id${++n}`, random: () => 0.5, ...over });
  return { tracer, store, tick: (ms) => (t += ms) };
}

test("nests spans through await and stores the whole trace when the root ends", async () => {
  const { tracer, tick } = setup();
  const result = await tracer.trace("request", async (root) => {
    root.setAttribute("route", "/api/chat");
    tick(5);
    await tracer.trace("db.query", async () => tick(20), { attributes: { table: "venues" } });
    await tracer.trace("llm.call", async () => {
      tick(100);
      await tracer.trace("tool.searchVenues", async () => tick(10));
    });
    return "done";
  });
  assert.equal(result, "done");
  const [trace] = await tracer.listTraces();
  assert.equal(trace.name, "request");
  assert.equal(trace.status, "ok");
  assert.equal(trace.durationMs, 135);
  const by = Object.fromEntries(trace.spans.map((s) => [s.name, s]));
  assert.equal(trace.spans[0].name, "request");
  assert.equal(by.request.parentId, null);
  assert.equal(by["db.query"].parentId, by.request.spanId);
  assert.equal(by["tool.searchVenues"].parentId, by["llm.call"].spanId);
  assert.equal(by["db.query"].durationMs, 20);
  assert.equal(by["llm.call"].durationMs, 110);
  assert.deepEqual(by["db.query"].attributes, { table: "venues" });
  assert.equal(by.request.attributes.route, "/api/chat");
  assert.deepEqual(await tracer.getTrace(trace.traceId), trace);
});

test("concurrent traces don't share context", async () => {
  const { tracer } = setup({ id: (() => { let i = 0; return () => `x${++i}`; })() });
  const work = (label) =>
    tracer.trace(label, async () => {
      await new Promise((r) => setTimeout(r, 5));
      await tracer.trace(`${label}.child`, async () => new Promise((r) => setTimeout(r, 5)));
    });
  await Promise.all([work("a"), work("b")]);
  const traces = await tracer.listTraces();
  assert.equal(traces.length, 2);
  for (const t of traces) {
    assert.equal(t.spans.length, 2);
    assert.equal(t.spans[1].name, `${t.name}.child`);
    assert.equal(t.spans[1].parentId, t.spans[0].spanId);
  }
});

test("errors are recorded and re-thrown; a caught child error still marks the trace failed", async () => {
  const { tracer } = setup();
  await assert.rejects(tracer.trace("boom", async () => { throw new TypeError("bad input"); }), TypeError);
  await tracer.trace("handled", async () => {
    await tracer.trace("flaky", async () => { throw new Error("upstream 503"); }).catch(() => {});
  });
  const [handled, boom] = await tracer.listTraces();
  assert.deepEqual(boom.spans[0].error, { name: "TypeError", message: "bad input" });
  assert.equal(boom.status, "error");
  assert.equal(handled.spans[0].status, "ok");
  assert.equal(handled.spans[1].status, "error");
  assert.equal(handled.status, "error");
  assert.deepEqual((await tracer.listTraces({ status: "error", limit: 5 })).map((t) => t.name), ["handled", "boom"]);
});

test("recordError marks a span failed without throwing; root: true starts a separate trace", async () => {
  const { tracer } = setup();
  await tracer.trace("outer", async (span) => {
    span.recordError({ code: 429 });
    await tracer.trace("detached", async () => {}, { root: true });
  });
  const names = (await tracer.listTraces()).map((t) => [t.name, t.status, t.spans.length]);
  assert.deepEqual(names, [["outer", "error", 1], ["detached", "ok", 1]]);
});

test("wrap() traces a function and can capture sanitized arguments", async () => {
  const { tracer } = setup();
  const search = tracer.wrap("tool.searchVenues", async (q, opts) => `${q}:${opts.limit}`, { captureArgs: true });
  assert.equal(await search("rooftop", { limit: 5, apiKey: "sk-live-123" }), "rooftop:5");
  const [t] = await tracer.listTraces();
  assert.deepEqual(t.spans[0].attributes.args, ["rooftop", { limit: 5, apiKey: "[redacted]" }]);
});

test("sanitize redacts secrets, masks emails, caps sizes and handles odd values", () => {
  const circular = { a: 1 };
  circular.self = circular;
  const out = sanitize({
    password: "hunter2",
    headers: { Authorization: "Bearer abc", accept: "json" },
    note: "token sb_secret_abc lives here", // key is fine, value isn't secret-prefixed
    key: "sb_secret_W_uE2bOFxTGCx6N",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    email: "Contact priya.raman@nimbus.example now",
    long: "x".repeat(600),
    list: Array.from({ length: 25 }, (_, i) => i),
    deep: { a: { b: { c: { d: { e: 1 } } } } },
    when: new Date(0),
    big: 10n,
    fn: function named() {},
    circular,
    nan: NaN,
  });
  assert.equal(out.password, "[redacted]");
  assert.equal(out.headers.Authorization, "[redacted]");
  assert.equal(out.headers.accept, "json");
  assert.equal(out.note, "token sb_secret_abc lives here");
  assert.equal(out.key, "[redacted]");
  assert.equal(out.jwt, "[redacted]");
  assert.equal(out.email, "Contact p***@nimbus.example now");
  assert.match(out.long, /^x{500}…\[\+100\]$/);
  assert.equal(out.list.length, 21);
  assert.equal(out.list.at(-1), "…[+5]");
  assert.deepEqual(out.deep, { a: { b: { c: "[object]" } } });
  assert.equal(out.when, "1970-01-01T00:00:00.000Z");
  assert.equal(out.big, "10");
  assert.equal(out.fn, "[function named]");
  assert.equal(out.circular.self, "[circular]");
  assert.equal(out.nan, "NaN");
});

test("sampling drops successes above the rate but always keeps errors", async () => {
  const { tracer } = setup({ sampleRate: 0.25, random: () => 0.9 });
  await tracer.trace("ok", async () => {});
  await assert.rejects(tracer.trace("fails", async () => { throw new Error("x"); }));
  assert.deepEqual((await tracer.listTraces()).map((t) => t.name), ["fails"]);
});

test("span limit and size cap drop spans and say how many", async () => {
  const { tracer } = setup({ maxSpansPerTrace: 3 });
  await tracer.trace("root", async () => {
    for (let i = 0; i < 5; i++) await tracer.trace(`child${i}`, async () => {});
  });
  const [t] = await tracer.listTraces();
  assert.deepEqual(t.spans.map((s) => s.name), ["root", "child0", "child1"]);
  assert.equal(t.droppedSpans, 3);

  const small = setup({ maxTraceBytes: 900 });
  await small.tracer.trace("root", async () => {
    for (let i = 0; i < 10; i++) await small.tracer.trace(`c${i}`, async () => {}, { attributes: { blob: "y".repeat(400) } });
  });
  const [s] = await small.tracer.listTraces();
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= 900);
  assert.ok(s.droppedSpans > 0);
  assert.deepEqual(s.spans[1].attributes, {});
});

test("a store failure never reaches the caller", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const tracer = new Tracer({ store: { save: async () => { throw new Error("redis down"); }, list: async () => [], get: async () => null } });
    assert.equal(await tracer.trace("x", () => 42), 42);
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1);
});

test("spanStats aggregates per span name, slowest p95 first", () => {
  const span = (name, durationMs, status = "ok") => ({ spanId: "s", parentId: null, name, start: 0, durationMs, status, attributes: {} });
  const traces = [
    { traceId: "1", name: "req", start: 10, durationMs: 0, status: "ok", droppedSpans: 0, spans: [span("db", 10), span("llm", 900)] },
    { traceId: "2", name: "req", start: 20, durationMs: 0, status: "error", droppedSpans: 0, spans: [span("db", 30), span("llm", 1500, "error")] },
    { traceId: "3", name: "req", start: 1, durationMs: 0, status: "ok", droppedSpans: 0, spans: [span("db", 999)] },
  ];
  const [llm, db] = spanStats(traces, { since: 5 });
  assert.deepEqual(llm, { name: "llm", count: 2, errors: 1, avgMs: 1200, p50Ms: 1500, p95Ms: 1500, maxMs: 1500 });
  assert.deepEqual(db, { name: "db", count: 2, errors: 0, avgMs: 20, p50Ms: 30, p95Ms: 30, maxMs: 30 });
});

test("redis store: one pipeline per trace (list + trim + keyed copy with TTL)", async () => {
  const calls = [];
  const pipe = { lpush: (...a) => (calls.push(["lpush", ...a]), pipe), ltrim: (...a) => (calls.push(["ltrim", ...a]), pipe), set: (...a) => (calls.push(["set", ...a]), pipe), exec: async () => calls.push(["exec"]) };
  const saved = { traceId: "abc", name: "r", start: 0, durationMs: 1, status: "ok", spans: [], droppedSpans: 0 };
  const store = redisTraceStore({ pipeline: () => pipe, lrange: async () => [saved, JSON.stringify(saved)], get: async () => JSON.stringify(saved) }, 100);
  await store.save(saved);
  assert.deepEqual(calls.map((c) => c[0]), ["lpush", "ltrim", "set", "exec"]);
  assert.deepEqual(calls[1], ["ltrim", "lufer:traces", 0, 99]);
  assert.deepEqual(calls[2].slice(1), ["lufer:trace:abc", JSON.stringify(saved), { ex: 604800 }]);
  assert.deepEqual(await store.list(10), [saved, saved]);
  assert.deepEqual(await store.get("abc"), saved);
});

test("startSpan: ends explicitly, and spans started in run() are its children", async () => {
  const { tracer, tick } = setup();
  await tracer.trace("route", async () => {
    const llm = tracer.startSpan("llm.stream", { attributes: { model: "gpt-4o" } });
    await llm.run(() => tracer.trace("llm.http", async () => tick(40)));
    tick(10);
    llm.setAttribute("tokens", 120);
    llm.end();
    llm.end(); // idempotent
  });
  const [t] = await tracer.listTraces();
  const by = Object.fromEntries(t.spans.map((s) => [s.name, s]));
  assert.equal(by["llm.http"].parentId, by["llm.stream"].spanId);
  assert.equal(by["llm.stream"].durationMs, 50);
  assert.deepEqual(by["llm.stream"].attributes, { model: "gpt-4o", tokens: 120 });
  assert.equal(t.spans.length, 3);
});

const streamOf = (chunks, tick) =>
  new ReadableStream({
    async pull(c) {
      if (!chunks.length) return c.close();
      tick?.(30);
      c.enqueue(new TextEncoder().encode(chunks.shift()));
    },
  });

test("traceResponse: the trace stays open until the streamed body is fully read", async () => {
  const { tracer, tick } = setup();
  const handler = tracer.traceResponse(
    "api.chat",
    async () => {
      const llm = tracer.startSpan("llm.stream");
      return new Response(streamOf(["a", "b", "c"], tick).pipeThrough(new TransformStream({ flush: () => llm.end() })), { status: 200 });
    },
    (req) => ({ path: new URL(req.url).pathname })
  );
  const res = await handler(new Request("http://x/api/chat", { method: "POST" }));
  assert.equal((await tracer.listTraces()).length, 0); // not finished yet
  assert.equal(await res.text(), "abc");
  const [t] = await tracer.listTraces();
  assert.equal(t.name, "api.chat");
  assert.equal(t.durationMs, 90);
  assert.deepEqual(t.spans[0].attributes, { path: "/api/chat", "http.status": 200 });
  assert.equal(t.spans[1].name, "llm.stream");
});

test("traceResponse: client disconnect, 5xx and thrown handlers are recorded", async () => {
  const { tracer } = setup();
  const streaming = tracer.traceResponse("api.stream", async () => new Response(streamOf(["a", "b", "c"])));
  const res = await streaming();
  const reader = res.body.getReader();
  await reader.read();
  await reader.cancel("client went away");
  await tracer.traceResponse("api.down", async () => Response.json({ error: "x" }, { status: 503 }))().then((r) => r.text());
  await assert.rejects(tracer.traceResponse("api.bug", async () => { throw new Error("bug"); })(), /bug/);
  const by = Object.fromEntries((await tracer.listTraces()).map((t) => [t.name, t]));
  assert.equal(by["api.stream"].spans[0].attributes["http.cancelled"], true);
  assert.equal(by["api.stream"].status, "ok");
  assert.equal(by["api.down"].status, "error");
  assert.equal(by["api.down"].spans[0].attributes["http.status"], 503);
  assert.deepEqual(by["api.bug"].spans[0].error, { name: "Error", message: "bug" });
});

test("secret keys vs metric keys", () => {
  const out = sanitize({ token: "a", accessToken: "b", refresh_token: "c", "x-token": "d", tokens: 5, totalTokens: 9, author: "Priya", auth: "e" });
  assert.deepEqual(out, { token: "[redacted]", accessToken: "[redacted]", refresh_token: "[redacted]", "x-token": "[redacted]", tokens: 5, totalTokens: 9, author: "Priya", auth: "[redacted]" });
});

test("annotate() adds to the active span and is a no-op outside a trace", async () => {
  const { tracer } = setup();
  tracer.annotate({ ignored: true });
  await tracer.trace("root", async () => {
    tracer.annotate({ role: "ADMIN" });
    await tracer.trace("child", async () => tracer.annotate({ rows: 3 }));
  });
  const [t] = await tracer.listTraces();
  assert.deepEqual(t.spans.map((s) => s.attributes), [{ role: "ADMIN" }, { rows: 3 }]);
});

import { summarizeTraces } from "../lib/tracer.ts";

test("summarizeTraces splits routes from operations, filters by period and lists failures", () => {
  const span = (name, durationMs, parentId, status = "ok") => ({ spanId: name, parentId, name, start: 0, durationMs, status, attributes: {} });
  const t = (id, start, status, spans) => ({ traceId: id, name: spans[0].name, start, durationMs: spans[0].durationMs, status, droppedSpans: 0, spans });
  const all = [
    t("3", 300, "error", [span("api.chat", 900, null), span("llm.http", 800, "api.chat", "error")]),
    t("2", 200, "ok", [span("api.chat", 500, null), span("tool.searchVenues", 40, "api.chat")]),
    t("1", 50, "error", [span("webhook.slack", 20, null, "error")]), // before the period
  ];
  const s = summarizeTraces(all, 100, { listLimit: 3 });
  assert.equal(s.traces, 2);
  assert.deepEqual(s.routes.map((r) => [r.name, r.count, r.errors]), [["api.chat", 2, 1]]);
  assert.deepEqual(s.operations.map((r) => r.name), ["llm.http", "tool.searchVenues"]);
  assert.deepEqual(s.failures.map((f) => f.traceId), ["3"]);
  assert.equal(s.trimmedBefore, null); // the oldest held trace predates the period
  assert.equal(summarizeTraces(all.slice(0, 2), 100, { listLimit: 2 }).trimmedBefore, 200);
});
