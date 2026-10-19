/**
 * Provider health shared across server instances: what each circuit breaker
 * (lib/circuit-breaker) has counted and which state it is in, so /agents shows
 * every instance's view rather than whichever instance rendered the page.
 *
 * - Redis (Upstash): counters go into hourly hashes
 *   `lufer:provider:<breaker>:stats:<hour>` (kept 25 h, summed over the last 24),
 *   each instance's latest snapshot into `lufer:provider:<breaker>:instances`,
 *   and state transitions onto a capped list.
 * - Memory: the same data in process memory (this instance only).
 *
 * Counter changes are batched for a short window, so a call with retries costs
 * one round trip, not five. Recording never throws into the caller.
 *
 * No server-only imports or path aliases, so tests can import it directly
 * (tests/provider-health.test.mjs). lib/ai/model.ts calls trackBreaker() for
 * the shared LLM breaker; lib/agents/observability.ts reads it.
 */
import { Redis } from "@upstash/redis";

import type { CircuitBreaker, CircuitEvent, CircuitSnapshot, CircuitStat, CircuitState } from "../circuit-breaker.ts";

export type CircuitStats = CircuitSnapshot["stats"];

/** One instance's breaker, as of its last counter change or transition. */
export interface InstanceCircuit {
  instance: string;
  state: CircuitState;
  consecutiveFailures: number;
  retryAt: number | null;
  /** Epoch ms of the last change. */
  at: number;
}

export interface CircuitTransition {
  instance: string;
  from: CircuitState;
  to: CircuitState;
  at: number;
}

export interface SharedProviderHealth {
  /** Summed over every instance for the last 24 hours. */
  stats24h: CircuitStats;
  /** Instances heard from in the last 24 hours, most recent first. */
  instances: InstanceCircuit[];
  /** Newest first. */
  transitions: CircuitTransition[];
}

export interface ProviderHealthStore {
  readonly source: "redis" | "memory";
  /** Queues one breaker event; resolves once written. Never rejects. */
  record(instance: string, event: CircuitEvent): Promise<void>;
  read(breaker: string, now?: number): Promise<SharedProviderHealth>;
}

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;
const DAY_MS = WINDOW_HOURS * HOUR_MS;
/** Transitions kept per breaker. */
export const TRANSITION_LIMIT = 50;
const BATCH_MS = 1_000;

export const STAT_KEYS: readonly CircuitStat[] = ["calls", "successes", "failures", "rejected", "retries", "fallbacks"];

const emptyStats = (): CircuitStats => ({ calls: 0, successes: 0, failures: 0, rejected: 0, retries: 0, fallbacks: 0 });
const hourOf = (at: number) => Math.floor(at / HOUR_MS);

const statsKey = (breaker: string, hour: number) => `lufer:provider:${breaker}:stats:${hour}`;
const instancesKey = (breaker: string) => `lufer:provider:${breaker}:instances`;
const transitionsKey = (breaker: string) => `lufer:provider:${breaker}:transitions`;

/** What one flush writes: counter deltas per breaker and hour, latest snapshots, transitions in order. */
interface Batch {
  deltas: Map<string, { breaker: string; hour: number; stats: CircuitStats }>;
  latest: Map<string, InstanceCircuit & { breaker: string }>;
  transitions: (CircuitTransition & { breaker: string })[];
}

const emptyBatch = (): Batch => ({ deltas: new Map(), latest: new Map(), transitions: [] });

function add(batch: Batch, instance: string, event: CircuitEvent) {
  const breaker = event.snapshot.name;
  if (event.type === "stat") {
    const hour = hourOf(event.at);
    const key = `${breaker}:${hour}`;
    const d = batch.deltas.get(key) ?? { breaker, hour, stats: emptyStats() };
    d.stats[event.stat]++;
    batch.deltas.set(key, d);
  } else {
    batch.transitions.push({ breaker, instance, from: event.from, to: event.to, at: event.at });
  }
  const { state, consecutiveFailures, retryAt } = event.snapshot;
  batch.latest.set(`${breaker}:${instance}`, { breaker, instance, state, consecutiveFailures, retryAt, at: event.at });
}

/** Collects events made within `ms` into one `flush`. */
function batcher(flush: (batch: Batch) => Promise<void>, ms: number) {
  let pending = emptyBatch();
  let scheduled: Promise<void> | null = null;
  return (instance: string, event: CircuitEvent): Promise<void> => {
    add(pending, instance, event);
    scheduled ??= new Promise<void>((resolve) => {
      setTimeout(() => {
        const batch = pending;
        pending = emptyBatch();
        scheduled = null;
        flush(batch)
          .catch((err) => console.error("provider-health: could not record breaker events", err))
          .finally(resolve);
      }, ms);
    });
    return scheduled;
  };
}

/** Instances seen in the window, newest first; also returns the ones to forget. */
function liveInstances(all: InstanceCircuit[], now: number) {
  const since = now - DAY_MS;
  return {
    live: all.filter((i) => i.at >= since).sort((a, b) => b.at - a.at),
    stale: all.filter((i) => i.at < since).map((i) => i.instance),
  };
}

export function memoryProviderHealthStore(batchMs = BATCH_MS): ProviderHealthStore {
  const hours = new Map<string, CircuitStats>(); // `${breaker}:${hour}`
  const instances = new Map<string, Map<string, InstanceCircuit>>();
  const transitions = new Map<string, CircuitTransition[]>();
  return {
    source: "memory",
    record: batcher(async (batch) => {
      for (const { breaker, hour, stats } of batch.deltas.values()) {
        const key = `${breaker}:${hour}`;
        const total = hours.get(key) ?? emptyStats();
        for (const k of STAT_KEYS) total[k] += stats[k];
        hours.set(key, total);
      }
      for (const { breaker, ...snap } of batch.latest.values()) {
        if (!instances.has(breaker)) instances.set(breaker, new Map());
        instances.get(breaker)!.set(snap.instance, snap);
      }
      for (const { breaker, ...t } of batch.transitions) {
        const list = transitions.get(breaker) ?? [];
        list.unshift(t);
        list.length = Math.min(list.length, TRANSITION_LIMIT);
        transitions.set(breaker, list);
      }
    }, batchMs),
    async read(breaker, now = Date.now()) {
      const stats24h = emptyStats();
      const current = hourOf(now);
      for (let h = current - WINDOW_HOURS + 1; h <= current; h++) {
        const s = hours.get(`${breaker}:${h}`);
        if (s) for (const k of STAT_KEYS) stats24h[k] += s[k];
      }
      for (const key of hours.keys()) if (Number(key.slice(key.lastIndexOf(":") + 1)) <= current - WINDOW_HOURS) hours.delete(key);
      const known = instances.get(breaker) ?? new Map<string, InstanceCircuit>();
      const { live, stale } = liveInstances([...known.values()], now);
      for (const id of stale) known.delete(id);
      return { stats24h, instances: live, transitions: [...(transitions.get(breaker) ?? [])] };
    },
  };
}

/** The Upstash calls the store makes (a subset of @upstash/redis's Redis). */
export interface ProviderHealthRedis {
  hincrby(key: string, field: string, increment: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  hset(key: string, values: Record<string, string>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  hdel(key: string, ...fields: string[]): Promise<unknown>;
  lpush(key: string, ...values: string[]): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
}

/** Upstash JSON-decodes stored values; tolerate raw strings too. */
function decode<T>(value: unknown): T | null {
  try {
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } catch {
    return null;
  }
}

export function redisProviderHealthStore(redis: ProviderHealthRedis, batchMs = BATCH_MS): ProviderHealthStore {
  return {
    source: "redis",
    record: batcher(async (batch) => {
      const writes: Promise<unknown>[] = [];
      for (const { breaker, hour, stats } of batch.deltas.values()) {
        const key = statsKey(breaker, hour);
        for (const k of STAT_KEYS) if (stats[k]) writes.push(redis.hincrby(key, k, stats[k]));
        writes.push(redis.expire(key, (WINDOW_HOURS + 1) * 3600));
      }
      const byBreaker = new Map<string, Record<string, string>>();
      for (const { breaker, ...snap } of batch.latest.values()) {
        byBreaker.set(breaker, { ...byBreaker.get(breaker), [snap.instance]: JSON.stringify(snap) });
      }
      for (const [breaker, values] of byBreaker) writes.push(redis.hset(instancesKey(breaker), values));
      await Promise.all(writes);
      // Transitions in order, after the snapshots, so a reader never sees a transition without its state.
      for (const { breaker, ...t } of batch.transitions) {
        await redis.lpush(transitionsKey(breaker), JSON.stringify(t));
        await redis.ltrim(transitionsKey(breaker), 0, TRANSITION_LIMIT - 1);
      }
    }, batchMs),
    async read(breaker, now = Date.now()) {
      const current = hourOf(now);
      const hourList = Array.from({ length: WINDOW_HOURS }, (_, i) => current - i);
      const [hashes, rawInstances, rawTransitions] = await Promise.all([
        Promise.all(hourList.map((h) => redis.hgetall(statsKey(breaker, h)))),
        redis.hgetall(instancesKey(breaker)),
        redis.lrange(transitionsKey(breaker), 0, TRANSITION_LIMIT - 1),
      ]);
      const stats24h = emptyStats();
      for (const hash of hashes) for (const k of STAT_KEYS) stats24h[k] += Number(hash?.[k] ?? 0) || 0;
      const all = Object.values(rawInstances ?? {})
        .map((v) => decode<InstanceCircuit>(v))
        .filter((i): i is InstanceCircuit => !!i && typeof i.instance === "string" && typeof i.at === "number");
      const { live, stale } = liveInstances(all, now);
      if (stale.length) await redis.hdel(instancesKey(breaker), ...stale).catch(() => {});
      const transitions = rawTransitions.map((v) => decode<CircuitTransition>(v)).filter((t): t is CircuitTransition => !!t && typeof t.at === "number");
      return { stats24h, instances: live, transitions };
    },
  };
}

/**
 * The state to show for a breaker across instances: the worst one still in force.
 * An OPEN record whose retry time has passed, or a HALF_OPEN one not heard from
 * within `staleMs`, describes an instance that has moved on (or gone), so it no
 * longer counts.
 */
export function combinedCircuit(instances: InstanceCircuit[], now: number, staleMs = 10 * 60_000): InstanceCircuit | null {
  const open = instances.filter((i) => i.state === "OPEN" && i.retryAt !== null && i.retryAt > now);
  if (open.length) return open.reduce((a, b) => ((b.retryAt ?? 0) > (a.retryAt ?? 0) ? b : a));
  const halfOpen = instances.filter((i) => i.state === "HALF_OPEN" && now - i.at < staleMs);
  if (halfOpen.length) return halfOpen[0];
  return null;
}

// ----------------------------------------------------------------------------
// App store
// ----------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __luferProviderHealth?: ProviderHealthStore; __luferTrackedBreakers?: Set<string>; __luferInstanceId?: string };

/** Created on first use (and kept on globalThis across `next dev` reloads). */
export function appProviderHealthStore(): ProviderHealthStore {
  if (g.__luferProviderHealth) return g.__luferProviderHealth;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  g.__luferProviderHealth = url && token ? redisProviderHealthStore(new Redis({ url, token })) : memoryProviderHealthStore();
  return g.__luferProviderHealth;
}

/** This process, in the instances hash: region (on Vercel) plus a random suffix. */
export const instanceId = () => (g.__luferInstanceId ??= `${process.env.VERCEL_REGION ?? "local"}-${crypto.randomUUID().slice(0, 8)}`);

/** Records the breaker's events in the app store. Once per breaker name per process. */
export function trackBreaker(breaker: CircuitBreaker) {
  const tracked = (g.__luferTrackedBreakers ??= new Set());
  if (tracked.has(breaker.name)) return;
  tracked.add(breaker.name);
  breaker.subscribe((event) => {
    const work = appProviderHealthStore().record(instanceId(), event);
    // Keep the function alive for the batched write after the response is sent.
    import("next/server")
      .then(({ after }) => after(work))
      .catch(() => {});
  });
}
