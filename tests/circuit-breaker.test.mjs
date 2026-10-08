import { test } from "node:test";
import assert from "node:assert/strict";
import { CallTimeoutError, CircuitBreaker, CircuitOpenError, isTransientError, retryAfterMs, statusOf } from "../lib/circuit-breaker.ts";

/** A breaker on a fake clock: sleeps advance time instantly and are recorded. */
function setup(over = {}) {
  let now = 1_000_000;
  const sleeps = [];
  const changes = [];
  const cb = new CircuitBreaker({
    name: "test",
    failureThreshold: 3,
    resetTimeoutMs: 10_000,
    halfOpenMaxCalls: 1,
    successThreshold: 2,
    retry: { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1_000 },
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
    onStateChange: (e) => changes.push(`${e.from}>${e.to}`),
    ...over,
  });
  return { cb, sleeps, changes, advance: (ms) => (now += ms) };
}

const httpError = (status, extra = {}) => Object.assign(new Error(`upstream failed (${status})`), { statusCode: status }, extra);
const failing = (err) => async () => {
  throw err;
};

test("classifies 429, 5xx, 408, timeouts and network errors as transient; other 4xx and aborts not", () => {
  for (const s of [408, 429, 500, 502, 503]) assert.equal(isTransientError(httpError(s)), true, String(s));
  for (const s of [400, 401, 403, 404, 422]) assert.equal(isTransientError(httpError(s)), false, String(s));
  assert.equal(isTransientError(Object.assign(new Error("x"), { code: "ECONNRESET" })), true);
  assert.equal(isTransientError(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } })), true);
  assert.equal(isTransientError(new CallTimeoutError(5)), true);
  assert.equal(isTransientError(Object.assign(new Error("aborted"), { name: "AbortError" })), false);
  assert.equal(isTransientError(new Error("plain bug")), false);
  assert.equal(statusOf({ response: { status: 503 } }), 503);
  assert.equal(statusOf(new Error("WhatsApp send failed (429): slow down")), 429);
});

test("retries transient errors with full-jitter exponential backoff, then succeeds", async () => {
  const { cb, sleeps } = setup();
  let calls = 0;
  const result = await cb.execute(async () => {
    if (++calls < 3) throw httpError(503);
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [50, 100]); // random 0.5 × ceilings 100, 200
  assert.equal(cb.snapshot().stats.retries, 2);
  assert.equal(cb.getState(), "CLOSED");
});

test("backoff ceiling is capped, and Retry-After is honoured up to the cap", async () => {
  const { cb, sleeps } = setup({ retry: { maxRetries: 3, baseDelayMs: 400, maxDelayMs: 1_000 }, random: () => 1 });
  await assert.rejects(cb.execute(failing(httpError(500))));
  assert.deepEqual(sleeps, [400, 800, 1_000]);

  const t = setup({ random: () => 0 });
  await assert.rejects(t.cb.execute(failing(httpError(429, { responseHeaders: { "Retry-After": "0.7" } }))));
  assert.deepEqual(t.sleeps, [700, 700]);
  assert.equal(retryAfterMs({ retryAfter: 5 }, 0), 5_000);
  assert.equal(retryAfterMs({ headers: new Headers({ "retry-after": new Date(60_000).toUTCString() }) }, 0), 60_000);
});

test("client errors are thrown at once: no retry, no failure count", async () => {
  const { cb, sleeps } = setup();
  let calls = 0;
  for (let i = 0; i < 5; i++) {
    await assert.rejects(cb.execute(async () => {
      calls++;
      throw httpError(400);
    }), /400/);
  }
  assert.equal(calls, 5);
  assert.deepEqual(sleeps, []);
  assert.equal(cb.getState(), "CLOSED");
  assert.equal(cb.snapshot().consecutiveFailures, 0);
});

test("opens after the threshold, fails fast, then half-opens and closes after enough trial successes", async () => {
  const { cb, changes, advance } = setup({ retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } });
  for (let i = 0; i < 3; i++) await assert.rejects(cb.execute(failing(httpError(502))));
  assert.equal(cb.getState(), "OPEN");

  let ran = false;
  await assert.rejects(cb.execute(async () => (ran = true)), CircuitOpenError);
  assert.equal(ran, false);
  assert.ok(cb.snapshot().retryAt > 0);

  advance(10_000);
  assert.equal(cb.getState(), "HALF_OPEN");
  assert.equal(await cb.execute(async () => "a"), "a");
  assert.equal(cb.getState(), "HALF_OPEN"); // needs 2 successes
  assert.equal(await cb.execute(async () => "b"), "b");
  assert.equal(cb.getState(), "CLOSED");
  assert.deepEqual(changes, ["CLOSED>OPEN", "OPEN>HALF_OPEN", "HALF_OPEN>CLOSED"]);
});

test("a failed trial call reopens the circuit and trial calls are never retried", async () => {
  const { cb, advance } = setup({ failureThreshold: 1 });
  await assert.rejects(cb.execute(failing(httpError(500))));
  assert.equal(cb.getState(), "OPEN");
  advance(10_000);
  let calls = 0;
  await assert.rejects(cb.execute(async () => {
    calls++;
    throw httpError(500);
  }));
  assert.equal(calls, 1);
  assert.equal(cb.getState(), "OPEN");
});

test("half-open admits only halfOpenMaxCalls at a time", async () => {
  const { cb, advance } = setup({ failureThreshold: 1, retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } });
  await assert.rejects(cb.execute(failing(httpError(500))));
  advance(10_000);
  let release;
  const first = cb.execute(() => new Promise((r) => (release = r)));
  await assert.rejects(cb.execute(async () => "second"), (e) => e instanceof CircuitOpenError && e.retryAt === null);
  release("first");
  assert.equal(await first, "first");
});

test("success in CLOSED resets the consecutive-failure count", async () => {
  const { cb } = setup({ retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } });
  await assert.rejects(cb.execute(failing(httpError(500))));
  await assert.rejects(cb.execute(failing(httpError(500))));
  await cb.execute(async () => "ok");
  await assert.rejects(cb.execute(failing(httpError(500))));
  assert.equal(cb.getState(), "CLOSED");
  assert.equal(cb.snapshot().consecutiveFailures, 1);
});

test("fallback handles open circuits and final failures; fallback errors propagate", async () => {
  const { cb } = setup({ failureThreshold: 1, retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } });
  const fallback = (e) => (e instanceof CircuitOpenError ? "cached" : `degraded: ${e.message}`);
  assert.equal(await cb.execute(failing(httpError(503)), { fallback }), "degraded: upstream failed (503)");
  assert.equal(await cb.execute(async () => "live", { fallback }), "cached");
  assert.equal(cb.snapshot().stats.fallbacks, 2);
  await assert.rejects(cb.execute(async () => "x", { fallback: () => { throw new Error("no cache"); } }), /no cache/);
});

test("per-attempt timeout aborts the attempt and counts as transient", async () => {
  const { cb } = setup({ callTimeoutMs: 20, retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 }, failureThreshold: 1 });
  let aborted = false;
  await assert.rejects(
    cb.execute((signal) => new Promise((_, reject) => signal.addEventListener("abort", () => ((aborted = true), reject(signal.reason))))),
    CallTimeoutError
  );
  assert.equal(aborted, true);
  assert.equal(cb.getState(), "OPEN");
});

test("caller abort stops retries and doesn't count against the upstream", async () => {
  const ctrl = new AbortController();
  const { cb } = setup({
    failureThreshold: 1,
    sleep: async () => {
      ctrl.abort(new Error("user cancelled"));
      throw ctrl.signal.reason;
    },
  });
  await assert.rejects(cb.execute(failing(httpError(503)), { signal: ctrl.signal }), /user cancelled/);
  assert.equal(cb.getState(), "CLOSED");
});

test("rejects nonsensical configuration", () => {
  assert.throws(() => setup({ failureThreshold: 0 }), RangeError);
  assert.throws(() => setup({ retry: { maxRetries: 1, baseDelayMs: 500, maxDelayMs: 100 } }), RangeError);
});
