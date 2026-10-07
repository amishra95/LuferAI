import "server-only";

import { Redis } from "@upstash/redis";

import { RedisLockStore } from "./redis-store";
import { MemoryLockStore, SlotLocks } from "./slot-lock";

export { CHECKOUT_LOCK_TTL_MS, SUBMIT_LOCK_TTL_MS, ownerOf, type AcquireResult, type Slot } from "./slot-lock";

const g = globalThis as typeof globalThis & { __luferSlotLocks?: { locks: SlotLocks; distributed: boolean } };

/**
 * Shared slot locks: Upstash Redis when UPSTASH_REDIS_REST_URL / _TOKEN are set
 * (the same database as the AI rate limiter), otherwise a per-process memory
 * store, which only coordinates requests on one server instance.
 */
export function getSlotLocks(): { locks: SlotLocks; distributed: boolean } {
  if (g.__luferSlotLocks) return g.__luferSlotLocks;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  g.__luferSlotLocks =
    url && token
      ? // Raw strings in and out: tokens are compared byte-for-byte in Lua.
        { locks: new SlotLocks(new RedisLockStore(new Redis({ url, token, automaticDeserialization: false }))), distributed: true }
      : { locks: new SlotLocks(new MemoryLockStore()), distributed: false };
  return g.__luferSlotLocks;
}
