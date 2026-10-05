import "server-only";

import { listConfirmedVenueBookings, listLiveHolds } from "@/lib/data";
import { findVenueLocks, type AvailabilityResult } from "./venue-locks";

export type { AvailabilityResult, VenueLock } from "./venue-locks";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is the venue free on every date in [from, to] (inclusive, YYYY-MM-DD)?
 * Locked dates come from live holds (ACTIVE, not yet expired) and CONFIRMED
 * bookings. Pass excludeBookingId to ignore a booking's own hold, e.g. when
 * re-checking a booking that already holds the date.
 *
 * Advisory only: the inventory_holds insert trigger is what actually prevents
 * two live holds on the same venue/date, race-free.
 */
export async function checkHoldAvailability(input: {
  venue_id: string;
  from: string;
  to: string;
  exclude_booking_id?: string;
}): Promise<AvailabilityResult> {
  if (!ISO_DATE.test(input.from) || !ISO_DATE.test(input.to) || input.from > input.to) {
    throw new Error("checkHoldAvailability: from/to must be YYYY-MM-DD with from <= to");
  }
  const range = { from: input.from, to: input.to };
  const [holds, bookings] = await Promise.all([
    listLiveHolds(input.venue_id),
    listConfirmedVenueBookings(input.venue_id, range),
  ]);
  return findVenueLocks(holds, bookings, { ...range, excludeBookingId: input.exclude_booking_id });
}
