/**
 * LockStore over Redis (Upstash REST). Pure wiring: takes any client with
 * set / eval, so tests can pass a fake (tests/slot-lock.test.mjs).
 *
 * Each operation is one atomic Redis command: SET NX PX for acquire, and Lua
 * scripts for the compare-and-act steps, so no read-modify-write races exist
 * between server instances.
 */
import type { LockStore } from "./slot-lock.ts";

/** Minimal client surface (structurally matches @upstash/redis Redis). */
export interface RedisLike {
  set(key: string, value: string, opts: { nx: true; px: number }): Promise<unknown>;
  eval<TArgs extends unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData>;
}

/** Returns [value, pttl] or nil. */
export const INSPECT_SCRIPT = `
local v = redis.call("GET", KEYS[1])
if not v then return nil end
return { v, redis.call("PTTL", KEYS[1]) }`;

/** DEL if the value matches; returns 1/0. */
export const DELETE_IF_VALUE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0`;

/** PEXPIRE if the value matches; returns 1/0. */
export const EXPIRE_IF_VALUE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end
return 0`;

export class RedisLockStore implements LockStore {
  private readonly redis: RedisLike;

  constructor(redis: RedisLike) {
    this.redis = redis;
  }

  async setIfAbsent(key: string, value: string, ttlMs: number) {
    return (await this.redis.set(key, value, { nx: true, px: Math.ceil(ttlMs) })) === "OK";
  }

  async inspect(key: string) {
    const r = await this.redis.eval<[], [unknown, unknown] | null>(INSPECT_SCRIPT, [key], []);
    if (!r) return null;
    // Upstash may JSON-decode values; tokens are plain strings, so coerce back.
    const ttlMs = Number(r[1]);
    // PTTL -1 = no expiry (shouldn't happen for our keys), -2 = gone.
    if (ttlMs === -2) return null;
    return { value: String(r[0]), ttlMs: ttlMs < 0 ? Number.MAX_SAFE_INTEGER : ttlMs };
  }

  async deleteIfValue(key: string, value: string) {
    return Number(await this.redis.eval(DELETE_IF_VALUE_SCRIPT, [key], [value])) === 1;
  }

  async expireIfValue(key: string, value: string, ttlMs: number) {
    return Number(await this.redis.eval(EXPIRE_IF_VALUE_SCRIPT, [key], [value, String(Math.ceil(ttlMs))])) === 1;
  }
}
