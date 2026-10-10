import "server-only";

import { Redis } from "@upstash/redis";

import { DELETE_IF_VALUE_SCRIPT } from "@/lib/locks/redis-store";
import { backfillDefaults, mockDb, seedDb, type MockDb } from "./mock-store";

/**
 * The store behind lib/data when Supabase isn't configured.
 *
 * - Redis mode (UPSTASH_REDIS_REST_URL / _TOKEN set): each collection is a Redis
 *   hash `lufer:db:<collection>` of row id → JSON, seeded once from mock-store.ts.
 *   Data persists and is shared by every server instance.
 * - Memory mode: the in-memory seed copy in mock-store.ts (per instance, resets on restart).
 *
 * Reads load a snapshot of every collection in one pipelined request. Writes run
 * under a short Redis mutex and persist only the rows the callback changed, so the
 * read-check-write logic in lib/data (hold conflicts, status transitions) is atomic
 * across instances, as the Postgres triggers make it in Supabase mode.
 */

const COLLECTIONS = [
  "companies",
  "departments",
  "venues",
  "bookings",
  "onboarding",
  "users",
  "policies",
  "approvalChains",
  "approvals",
  "approvalComments",
  "holds",
  "rateCards",
  "expenseExports",
  "purchaseOrders",
  "poAllocations",
  "partners",
  "catalogItems",
  "catalogOrders",
] as const satisfies readonly (keyof MockDb)[];

const PREFIX = "lufer:db:";
const SEEDED_KEY = `${PREFIX}seeded`;
const LOCK_KEY = `${PREFIX}lock`;
const LOCK_TTL_MS = 10_000;
const LOCK_WAIT_MS = 8_000;

const keyOf = (c: keyof MockDb) => `${PREFIX}${c}`;
/** Row primary key: platform users are keyed by user_id, everything else by id. */
const idOf = (row: object) => String((row as { id?: string; user_id?: string }).id ?? (row as { user_id: string }).user_id);

const g = globalThis as typeof globalThis & { __luferDataRedis?: Redis | null };

/** The Upstash client for app data, or null without UPSTASH_REDIS_REST_URL / _TOKEN. */
export function getDataRedis(): Redis | null {
  if (g.__luferDataRedis !== undefined) return g.__luferDataRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  g.__luferDataRedis = url && token ? new Redis({ url, token }) : null;
  return g.__luferDataRedis;
}

export const isRedisConfigured = () => getDataRedis() !== null;

/** HGETALL result → rows. Upstash JSON-decodes values; tolerate raw strings too. */
function rowsOf<T>(hash: unknown): T[] {
  if (!hash || typeof hash !== "object") return [];
  return Object.values(hash as Record<string, unknown>).map((v) => (typeof v === "string" ? JSON.parse(v) : v) as T);
}

async function loadAll(redis: Redis): Promise<{ db: MockDb; seeded: boolean }> {
  const p = redis.pipeline();
  p.get(SEEDED_KEY);
  for (const c of COLLECTIONS) p.hgetall(keyOf(c));
  const [seeded, ...hashes] = await p.exec<unknown[]>();
  const db = backfillDefaults(Object.fromEntries(COLLECTIONS.map((c, i) => [c, rowsOf(hashes[i])])) as unknown as MockDb);
  return { db, seeded: seeded != null };
}

async function withLock<T>(redis: Redis, fn: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  while ((await redis.set(LOCK_KEY, token, { nx: true, px: LOCK_TTL_MS })) !== "OK") {
    if (Date.now() > deadline) throw new Error("The data store is busy. Please try again.");
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
  }
  try {
    return await fn();
  } finally {
    await redis.eval(DELETE_IF_VALUE_SCRIPT, [LOCK_KEY], [token]).catch((err) => console.error("data store: lock release failed", err));
  }
}

/** Writes the seed rows and the seeded marker in one MULTI. Caller holds the lock. */
async function seed(redis: Redis) {
  const tx = redis.multi();
  const db = seedDb();
  for (const c of COLLECTIONS) {
    const rows = db[c] as object[];
    if (rows.length) tx.hset(keyOf(c), Object.fromEntries(rows.map((r) => [idOf(r), JSON.stringify(r)])));
  }
  tx.set(SEEDED_KEY, new Date().toISOString());
  await tx.exec();
}

/** A snapshot of every collection. Mutating it changes nothing; use mutateDb. */
export async function readDb(): Promise<MockDb> {
  const redis = getDataRedis();
  if (!redis) return backfillDefaults(mockDb);
  const loaded = await loadAll(redis);
  if (loaded.seeded) return loaded.db;
  return withLock(redis, async () => {
    const again = await loadAll(redis);
    if (again.seeded) return again.db;
    await seed(redis);
    return (await loadAll(redis)).db;
  });
}

/**
 * Runs `fn` against the current data and persists whatever rows it added, changed
 * or removed. With Redis, concurrent mutations from any instance are serialised.
 * If `fn` throws, nothing is written.
 */
export async function mutateDb<T>(fn: (db: MockDb) => T): Promise<T> {
  const redis = getDataRedis();
  if (!redis) return fn(backfillDefaults(mockDb));
  await readDb(); // seeds on first use
  return withLock(redis, async () => {
    const { db } = await loadAll(redis);
    const before = new Map(COLLECTIONS.map((c) => [c, new Map((db[c] as object[]).map((r) => [idOf(r), JSON.stringify(r)]))]));
    const result = fn(db);

    const tx = redis.multi();
    let writes = 0;
    for (const c of COLLECTIONS) {
      const prev = before.get(c)!;
      const changed: Record<string, string> = {};
      const seen = new Set<string>();
      for (const row of db[c] as object[]) {
        const id = idOf(row);
        const json = JSON.stringify(row);
        seen.add(id);
        if (prev.get(id) !== json) changed[id] = json;
      }
      const removed = [...prev.keys()].filter((id) => !seen.has(id));
      if (Object.keys(changed).length) {
        tx.hset(keyOf(c), changed);
        writes++;
      }
      if (removed.length) {
        tx.hdel(keyOf(c), ...removed);
        writes++;
      }
    }
    if (writes) await tx.exec();
    return result;
  });
}
