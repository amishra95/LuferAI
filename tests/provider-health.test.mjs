import { test } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../lib/circuit-breaker.ts";
import { combinedCircuit, memoryProviderHealthStore, redisProviderHealthStore, TRANSITION_LIMIT } from "../lib/telemetry/provider-health.ts";

const HOUR = 3_600_000;

/** Enough of Upstash for the store: hashes and lists in Maps (values stored as strings). */
function fakeRedis() {
  const hashes = new Map();
  const lists = new Map();
  const expires = new Map();
  const hash = (k) => (hashes.has(k) ? hashes.get(k) : (hashes.set(k, {}), hashes.get(k)));
  return {
    hashes,
    lists,
    expires,
    async hincrby(k, f, n) {
      const h = hash(k);
      h[f] = String(Number(h[f] ?? 0) + n);
      return Number(h[f]);
    },
    async expire(k, s) {
      expires.set(k, s);
      return 1;
    },
    async hset(k, values) {
      Object.assign(hash(k), values);
      return Object.keys(values).length;
    },
    async hgetall(k) {
      const h = hashes.get(k);
      return h && Object.keys(h).length ? { ...h } : null;
    },
    async hdel(k, ...fields) {
      for (const f of fields) delete hash(k)[f];
      return fields.length;
    },
    async lpush(k, ...values) {
      lists.set(k, [...values.reverse(), ...(lists.get(k) ?? [])]);
      return lists.get(k).length;
    },
    async ltrim(k, start, stop) {
      lists.set(k, (lists.get(k) ?? []).slice(start, stop + 1));
      return "OK";
    },
    async lrange(k, start, stop) {
      return (lists.get(k) ?? []).slice(start, stop + 1);
    },
  };
}

const snap = (over = {}) => ({ name: "llm", state: "CLOSED", consecutiveFailures: 0, retryAt: null, stats: {}, ...over });
const stat = (stat, at, over) => ({ type: "stat", stat, at, snapshot: snap(over) });
const state = (from, to, at, over) => ({ type: "state", from, to, at, snapshot: snap({ state: to, ...over }) });

for (const [label, make] of [
  ["memory", () => memoryProviderHealthStore(0)],
  ["redis", () => redisProviderHealthStore(fakeRedis(), 0)],
]) {
  test(`${label}: sums counters from every instance over the last 24 hours`, async () => {
    const store = make();
    const now = 100 * HOUR + 1_000;
    await store.record("b", stat("calls", now - 30 * HOUR)); // outside the window
    await Promise.all([
      store.record("b", stat("calls", now - 2 * HOUR)),
      store.record("b", stat("failures", now - 2 * HOUR)),
      store.record("a", stat("calls", now - 1_000)),
      store.record("a", stat("successes", now - 1_000)),
    ]);
    const h = await store.read("llm", now);
    assert.deepEqual(h.stats24h, { calls: 2, successes: 1, failures: 1, rejected: 0, retries: 0, fallbacks: 0 });
    assert.deepEqual(
      h.instances.map((i) => i.instance),
      ["a", "b"]
    );
  });

  test(`${label}: keeps each instance's latest state and the transitions newest first`, async () => {
    const store = make();
    const now = 50 * HOUR;
    await store.record("a", state("CLOSED", "OPEN", now - 5_000, { consecutiveFailures: 5, retryAt: now + 25_000 }));
    await store.record("a", state("OPEN", "HALF_OPEN", now - 1_000));
    const h = await store.read("llm", now);
    assert.equal(h.instances.length, 1);
    assert.equal(h.instances[0].state, "HALF_OPEN");
    assert.deepEqual(
      h.transitions.map((t) => `${t.from}>${t.to}`),
      ["OPEN>HALF_OPEN", "CLOSED>OPEN"]
    );
  });

  test(`${label}: forgets instances not heard from in 24 hours and caps transitions`, async () => {
    const store = make();
    const now = 80 * HOUR;
    await store.record("old", stat("calls", now - 25 * HOUR));
    for (let i = 0; i < TRANSITION_LIMIT + 5; i++) await store.record("a", state("CLOSED", "OPEN", now - 1_000 + i));
    const h = await store.read("llm", now);
    assert.deepEqual(
      h.instances.map((i) => i.instance),
      ["a"]
    );
    assert.equal(h.transitions.length, TRANSITION_LIMIT);
    assert.equal(h.transitions[0].at, now - 1_000 + TRANSITION_LIMIT + 4);
  });
}

test("redis: one flush batches a call's counters into one hourly hash with a TTL", async () => {
  const redis = fakeRedis();
  const store = redisProviderHealthStore(redis, 0);
  const at = 10 * HOUR + 5;
  await Promise.all(["calls", "retries", "retries", "successes"].map((s) => store.record("a", stat(s, at))));
  assert.deepEqual(redis.hashes.get("lufer:provider:llm:stats:10"), { calls: "1", retries: "2", successes: "1" });
  assert.equal(redis.expires.get("lufer:provider:llm:stats:10"), 25 * 3600);
  assert.equal(JSON.parse(redis.hashes.get("lufer:provider:llm:instances").a).state, "CLOSED");
});

test("redis: a failing write is logged, not thrown", async () => {
  const down = () => Promise.reject(new Error("down"));
  const store = redisProviderHealthStore({ ...fakeRedis(), hincrby: down, expire: down, hset: down }, 0);
  const original = console.error;
  console.error = () => {};
  try {
    await store.record("a", stat("calls", Date.now()));
  } finally {
    console.error = original;
  }
});

test("combinedCircuit: an open circuit anywhere wins, until its retry time passes", () => {
  const now = 1_000_000;
  const closed = { instance: "a", state: "CLOSED", consecutiveFailures: 0, retryAt: null, at: now };
  const open = { instance: "b", state: "OPEN", consecutiveFailures: 5, retryAt: now + 10_000, at: now - 20_000 };
  const lapsed = { ...open, instance: "c", retryAt: now - 1 };
  const half = { instance: "d", state: "HALF_OPEN", consecutiveFailures: 5, retryAt: null, at: now - 60_000 };
  assert.equal(combinedCircuit([closed, open], now).instance, "b");
  assert.equal(combinedCircuit([closed, lapsed], now), null);
  assert.equal(combinedCircuit([closed, half], now).instance, "d");
  assert.equal(combinedCircuit([closed, { ...half, at: now - 11 * 60_000 }], now), null);
});

test("CircuitBreaker.subscribe reports counters and transitions with the state after each", async () => {
  let now = 0;
  const cb = new CircuitBreaker({
    name: "llm",
    failureThreshold: 1,
    resetTimeoutMs: 1_000,
    halfOpenMaxCalls: 1,
    successThreshold: 1,
    retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    now: () => now,
    isTransient: () => true,
  });
  const events = [];
  const stop = cb.subscribe((e) => events.push(e.type === "stat" ? `${e.stat}:${e.snapshot.state}` : `${e.from}>${e.to}`));
  cb.subscribe(() => {
    throw new Error("a broken listener must not break calls");
  });
  await assert.rejects(cb.execute(async () => Promise.reject(new Error("503"))));
  await assert.rejects(cb.execute(async () => "never runs"));
  now = 1_000;
  assert.equal(await cb.execute(async () => "ok"), "ok");
  stop();
  await cb.execute(async () => "ok");
  assert.deepEqual(events, ["calls:CLOSED", "CLOSED>OPEN", "failures:OPEN", "calls:OPEN", "rejected:OPEN", "calls:OPEN", "OPEN>HALF_OPEN", "HALF_OPEN>CLOSED", "successes:CLOSED"]);
});
