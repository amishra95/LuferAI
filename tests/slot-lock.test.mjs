// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryLockStore, ownerOf, slotKey, SlotLocks } from "../lib/locks/slot-lock.ts";
import { DELETE_IF_VALUE_SCRIPT, EXPIRE_IF_VALUE_SCRIPT, INSPECT_SCRIPT, RedisLockStore } from "../lib/locks/redis-store.ts";

const VENUE = "0b9a4c6e-1f2d-4e3a-9b8c-7d6e5f4a3b2c";
const slot = { venueId: VENUE, date: "2026-12-12" };

function setup() {
  let now = 1_000_000;
  let n = 0;
  const clock = { now: () => now, advance: (ms) => (now += ms) };
  const store = new MemoryLockStore(clock.now);
  const locks = new SlotLocks(store, { now: clock.now, nonce: () => `n${++n}` });
  return { clock, store, locks };
}

test("slot keys are namespaced and reject malformed slots", () => {
  assert.equal(slotKey(slot), `lufer:slot:${VENUE}:2026-12-12`);
  assert.throws(() => slotKey({ venueId: VENUE, date: "12/12/2026" }));
  assert.throws(() => slotKey({ venueId: "a b", date: "2026-12-12" }));
  assert.equal(ownerOf("user-1.abc123"), "user-1");
});

test("only one owner holds a slot; others learn when to retry", async () => {
  const { locks } = setup();
  const a = await locks.acquire(slot, "alice", 60_000);
  const b = await locks.acquire(slot, "bob", 60_000);
  assert.equal(a.ok, true);
  assert.deepEqual(b, { ok: false, reason: "held", retryAfterMs: 60_000 });
});

test("the same owner re-enters and refreshes the TTL instead of locking itself out", async () => {
  const { locks, clock } = setup();
  const first = await locks.acquire(slot, "alice", 60_000);
  clock.advance(50_000);
  const again = await locks.acquire(slot, "alice", 60_000);
  assert.equal(again.ok && again.reentered, true);
  assert.equal(again.ok && first.ok && again.token, first.ok && first.token);
  clock.advance(30_000); // 80s after the first grant, 30s after the refresh
  assert.equal((await locks.acquire(slot, "bob", 1_000)).ok, false);
});

test("locks expire on their own", async () => {
  const { locks, clock } = setup();
  await locks.acquire(slot, "alice", 60_000);
  clock.advance(60_000);
  assert.equal((await locks.acquire(slot, "bob", 60_000)).ok, true);
});

test("release and extend only work for the current token", async () => {
  const { locks, clock } = setup();
  const a = await locks.acquire(slot, "alice", 10_000);
  assert.ok(a.ok);
  clock.advance(10_000); // alice's lock lapses…
  const b = await locks.acquire(slot, "bob", 10_000); // …and bob takes the slot
  assert.ok(b.ok);
  assert.equal(await locks.release(slot, a.token), false, "stale holder can't delete bob's lock");
  assert.equal(await locks.extend(slot, a.token, 10_000), false, "or prolong it");
  assert.equal(await locks.holds(slot, b.token), true);
  assert.equal(await locks.release(slot, b.token), true);
  assert.equal(await locks.holds(slot, b.token), false);
});

test("a burst of concurrent checkouts yields exactly one winner", async () => {
  const { locks } = setup();
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => locks.acquire(slot, `user${i}`, 60_000)));
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("withSlot releases a lock it took, even when the work throws", async () => {
  const { locks } = setup();
  await assert.rejects(locks.withSlot(slot, "alice", async () => {
    throw new Error("boom");
  }));
  assert.equal((await locks.acquire(slot, "bob", 1_000)).ok, true);
});

test("withSlot refuses while another owner holds the slot", async () => {
  const { locks } = setup();
  await locks.acquire(slot, "alice", 60_000);
  let ran = false;
  const r = await locks.withSlot(slot, "bob", async () => (ran = true));
  assert.equal(r.ok, false);
  assert.equal(ran, false);
});

test("withSlot keeps a reused checkout lock after a failed submit, frees it after success", async () => {
  const { locks } = setup();
  const session = await locks.acquire(slot, "alice", 600_000);
  assert.ok(session.ok);

  const failed = await locks.withSlot(slot, "alice", async () => ({ status: "error" }), {
    token: session.token,
    succeeded: (r) => r.status === "success",
  });
  assert.equal(failed.ok, true);
  assert.equal(await locks.holds(slot, session.token), true, "reservation survives a validation error");

  await locks.withSlot(slot, "alice", async () => ({ status: "success" }), { token: session.token, succeeded: (r) => r.status === "success" });
  assert.equal(await locks.holds(slot, session.token), false, "booked: the database hold takes over");
});

test("someone else's token can't be used to enter a slot", async () => {
  const { locks } = setup();
  const a = await locks.acquire(slot, "alice", 600_000);
  assert.ok(a.ok);
  const r = await locks.withSlot(slot, "mallory", async () => "booked", { token: a.token });
  assert.equal(r.ok, false);
});

test("RedisLockStore issues atomic SET NX PX and token-checked scripts", async () => {
  // Fake Upstash client: a Map with TTLs, interpreting the three known scripts.
  let now = 0;
  const data = new Map();
  const live = (k) => {
    const e = data.get(k);
    if (e && e.exp <= now) data.delete(k);
    return data.get(k);
  };
  const calls = [];
  const fake = {
    async set(key, value, opts) {
      calls.push(["set", opts]);
      if (live(key)) return null;
      data.set(key, { value, exp: now + opts.px });
      return "OK";
    },
    async eval(script, keys, args) {
      const e = live(keys[0]);
      if (script === INSPECT_SCRIPT) return e ? [e.value, e.exp - now] : null;
      if (script === DELETE_IF_VALUE_SCRIPT) return e && e.value === args[0] ? (data.delete(keys[0]), 1) : 0;
      if (script === EXPIRE_IF_VALUE_SCRIPT) return e && e.value === args[0] ? ((e.exp = now + Number(args[1])), 1) : 0;
      throw new Error("unexpected script");
    },
  };
  const locks = new SlotLocks(new RedisLockStore(fake), { now: () => now, nonce: () => "x" });

  const a = await locks.acquire(slot, "alice", 5_000);
  assert.ok(a.ok);
  assert.deepEqual(calls[0], ["set", { nx: true, px: 5_000 }]);
  assert.deepEqual(await locks.acquire(slot, "bob", 5_000), { ok: false, reason: "held", retryAfterMs: 5_000 });
  assert.equal(await locks.release(slot, "bob.x"), false);
  assert.equal(await locks.release(slot, a.token), true);
  now += 1;
  assert.equal((await locks.acquire(slot, "bob", 5_000)).ok, true);
});
