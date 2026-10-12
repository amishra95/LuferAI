/**
 * Pure availability rules (tested in tests/rates-and-holds.test.mjs). Data
 * access lives in checkHoldAvailability.ts.
 *
 * A venue date is locked by:
 *  - an ACTIVE hold whose hold_expires_at is still in the future,
 *  - a CONFIRMED booking (holds are short-lived; a confirmed event keeps the date), or
 *  - a date the host blocked (venue_blocked_dates, migration 0025).
 */

export interface HoldCandidate {
  id: string;
  booking_id: string;
  status: "ACTIVE" | "RELEASED" | "CONVERTED";
  hold_expires_at: string;
  /** The held booking's event date, YYYY-MM-DD. */
  event_date: string;
}

export interface BookingCandidate {
  id: string;
  status: string;
  event_date: string;
}

export interface BlockCandidate {
  id: string;
  /** YYYY-MM-DD. */
  blocked_date: string;
  reason: string | null;
}

export type VenueLock =
  | { kind: "HOLD"; date: string; holdId: string; bookingId: string; expiresAt: string }
  | { kind: "BOOKING"; date: string; bookingId: string }
  | { kind: "BLOCKED"; date: string; blockId: string; reason: string | null };

export interface AvailabilityResult {
  available: boolean;
  locks: VenueLock[];
}

export function findVenueLocks(
  holds: HoldCandidate[],
  bookings: BookingCandidate[],
  range: { from: string; to: string; excludeBookingId?: string },
  now: Date = new Date(),
  blocks: BlockCandidate[] = []
): AvailabilityResult {
  const inRange = (d: string) => range.from <= d && d <= range.to;
  const notExcluded = (bookingId: string) => bookingId !== range.excludeBookingId;

  const locks: VenueLock[] = [
    ...holds
      .filter((h) => h.status === "ACTIVE" && new Date(h.hold_expires_at) > now && inRange(h.event_date) && notExcluded(h.booking_id))
      .map((h): VenueLock => ({ kind: "HOLD", date: h.event_date, holdId: h.id, bookingId: h.booking_id, expiresAt: h.hold_expires_at })),
    ...bookings
      .filter((b) => b.status === "CONFIRMED" && inRange(b.event_date) && notExcluded(b.id))
      .map((b): VenueLock => ({ kind: "BOOKING", date: b.event_date, bookingId: b.id })),
    // A host's block applies to every booking, including the excluded one.
    ...blocks.filter((b) => inRange(b.blocked_date)).map((b): VenueLock => ({ kind: "BLOCKED", date: b.blocked_date, blockId: b.id, reason: b.reason })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return { available: locks.length === 0, locks };
}
