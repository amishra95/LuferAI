/**
 * Distributed TTL slot locks for booking checkout. Pure core (tested in
 * tests/slot-lock.test.mjs) over a small LockStore interface; the Upstash
 * Redis store lives in redis-store.ts and the in-memory store below backs
 * tests and local development.
 *
 * A "slot" is one venue on one date. While someone is checking out a slot,
 * everyone else gets a fast, friendly "being booked right now" instead of
 * racing to the database. Locks are advisory and self-expiring: the
 * inventory_holds insert trigger stays the source of truth, so a lost or
 * expired lock can never double-book a venue.
 *
 * Safety properties:
 *  - Acquire is a single atomic SET NX PX: at most one owner per slot.
 *  - Release / extend are compare-and-act on the caller's token, so a client
 *    whose lock expired can't delete or prolong someone else's.
 *  - Re-entrant per owner: the same user re-acquiring (e.g. after editing the
 *    form) refreshes their lock instead of locking themselves out.
 */

/** Atomic primitives a lock backend must provide. */
export interface LockStore {
  /** SET key value NX PX ttlMs → true when set. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Current value and remaining TTL (ms), or null when absent/expired. */
  inspect(key: string): Promise<{ value: string; ttlMs: number } | null>;
  /** Delete only if the value still matches. */
  deleteIfValue(key: string, value: string): Promise<boolean>;
  /** Reset the TTL only if the value still matches. */
  expireIfValue(key: string, value: string, ttlMs: number): Promise<boolean>;
}

export interface Slot {
  venueId: string;
  /** YYYY-MM-DD */
  date: string;
}

export type AcquireResult =
  | { ok: true; token: string; expiresAt: number; reentered: boolean }
  | { ok: false; reason: "held"; retryAfterMs: number };

/** Checkout sessions: long enough to fill in the form, short enough not to strand a date. */
export const CHECKOUT_LOCK_TTL_MS = 10 * 60_000;
/** The submit critical section (re-price, availability, insert). */
export const SUBMIT_LOCK_TTL_MS = 30_000;

const SLOT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OWNER = /^[A-Za-z0-9:_-]{1,128}$/;

export function slotKey(slot: Slot, prefix = "lufer:slot"): string {
  if (!slot.venueId || /[\s{}]/.test(slot.venueId) || !SLOT_DATE.test(slot.date)) throw new Error("Invalid slot");
  return `${prefix}:${slot.venueId}:${slot.date}`;
}

/** Tokens are `${owner}.${nonce}`: the owner part enables re-entry, the nonce makes each grant unique. */
export function ownerOf(token: string): string {
  const i = token.lastIndexOf(".");
  return i > 0 ? token.slice(0, i) : "";
}

function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class SlotLocks {
  private readonly store: LockStore;
  private readonly opts: { prefix?: string; now?: () => number; nonce?: () => string };

  constructor(store: LockStore, opts: { prefix?: string; now?: () => number; nonce?: () => string } = {}) {
    this.store = store;
    this.opts = opts;
  }

  private key(slot: Slot) {
    return slotKey(slot, this.opts.prefix);
  }
  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** Take the slot for `owner`, or report how long until it may free up. */
  async acquire(slot: Slot, owner: string, ttlMs: number): Promise<AcquireResult> {
    if (!OWNER.test(owner)) throw new Error("Invalid lock owner");
    if (!(ttlMs > 0)) throw new Error("ttlMs must be positive");
    const key = this.key(slot);
    const token = `${owner}.${(this.opts.nonce ?? randomNonce)()}`;

    if (await this.store.setIfAbsent(key, token, ttlMs)) {
      return { ok: true, token, expiresAt: this.now() + ttlMs, reentered: false };
    }
    const current = await this.store.inspect(key);
    if (!current) {
      // Expired between the two calls: one more atomic attempt.
      if (await this.store.setIfAbsent(key, token, ttlMs)) return { ok: true, token, expiresAt: this.now() + ttlMs, reentered: false };
      const again = await this.store.inspect(key);
      return { ok: false, reason: "held", retryAfterMs: Math.max(0, again?.ttlMs ?? 0) };
    }
    if (ownerOf(current.value) === owner && (await this.store.expireIfValue(key, current.value, ttlMs))) {
      return { ok: true, token: current.value, expiresAt: this.now() + ttlMs, reentered: true };
    }
    return { ok: false, reason: "held", retryAfterMs: Math.max(0, current.ttlMs) };
  }

  /** Is `token` still the live holder of the slot? */
  async holds(slot: Slot, token: string): Promise<boolean> {
    const current = await this.store.inspect(this.key(slot));
    return current?.value === token;
  }

  /** Prolong the caller's own lock. False when it expired or someone else holds the slot. */
  extend(slot: Slot, token: string, ttlMs: number): Promise<boolean> {
    return this.store.expireIfValue(this.key(slot), token, ttlMs);
  }

  /** Free the caller's own lock. False when it had already expired or been taken over. */
  release(slot: Slot, token: string): Promise<boolean> {
    return this.store.deleteIfValue(this.key(slot), token);
  }

  /**
   * Run `fn` while holding the slot. With `token` (a checkout session the
   * caller started earlier) the session is reused if still live and owned by
   * `owner`; otherwise a fresh short lock is taken. Locks this call took are
   * always released; a reused checkout lock is released only when `fn`
   * reports success, so a failed submit keeps the user's reservation.
   */
  async withSlot<T>(
    slot: Slot,
    owner: string,
    fn: () => Promise<T>,
    options: { token?: string | null; ttlMs?: number; succeeded?: (result: T) => boolean } = {}
  ): Promise<{ ok: true; value: T } | { ok: false; retryAfterMs: number }> {
    const ttl = options.ttlMs ?? SUBMIT_LOCK_TTL_MS;
    let token: string | null = null;
    let reused = false;
    if (options.token && ownerOf(options.token) === owner && (await this.extend(slot, options.token, ttl))) {
      token = options.token;
      reused = true;
    } else {
      const got = await this.acquire(slot, owner, ttl);
      if (!got.ok) return { ok: false, retryAfterMs: got.retryAfterMs };
      token = got.token;
      // Re-entered an older session of ours: treat it like a reused checkout lock.
      reused = got.reentered;
    }

    let value: T;
    try {
      value = await fn();
    } catch (err) {
      if (!reused) await this.release(slot, token).catch(() => false);
      throw err;
    }
    const done = options.succeeded ? options.succeeded(value) : true;
    if (!reused || done) await this.release(slot, token).catch(() => false);
    return { ok: true, value };
  }
}

/**
 * Process-local store with the same semantics, for tests and single-instance
 * development. Not distributed: with several server instances use Redis.
 */
export class MemoryLockStore implements LockStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private live(key: string) {
    const e = this.entries.get(key);
    if (e && e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  async setIfAbsent(key: string, value: string, ttlMs: number) {
    if (this.live(key)) return false;
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    return true;
  }
  async inspect(key: string) {
    const e = this.live(key);
    return e ? { value: e.value, ttlMs: e.expiresAt - this.now() } : null;
  }
  async deleteIfValue(key: string, value: string) {
    const e = this.live(key);
    if (!e || e.value !== value) return false;
    this.entries.delete(key);
    return true;
  }
  async expireIfValue(key: string, value: string, ttlMs: number) {
    const e = this.live(key);
    if (!e || e.value !== value) return false;
    e.expiresAt = this.now() + ttlMs;
    return true;
  }
}
