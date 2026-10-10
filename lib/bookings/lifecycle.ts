/**
 * The booking lifecycle, in the app's words:
 *
 *   requested ─► awaiting approval ─► with venue ─► confirmed ─► completed ─► settled
 *        (PENDING_APPROVAL)            (PENDING)    (CONFIRMED)  (COMPLETED)  (SETTLED)
 *   …and CANCELLED from anywhere before the event.
 *
 * ALLOWED_TRANSITIONS mirrors the bookings_guard_status_transition trigger
 * (supabase/migrations/20261010120100_corporate_venue_os.sql), so local data
 * and Supabase reject the same moves.
 *
 * Pure: tests import it directly (tests/corporate-venue-os.test.mjs).
 */

export const BOOKING_STATUSES = ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "SETTLED", "CANCELLED"] as const;
export type LifecycleStatus = (typeof BOOKING_STATUSES)[number];

export const ALLOWED_TRANSITIONS: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  PENDING_APPROVAL: ["PENDING", "CANCELLED"],
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["SETTLED"],
  SETTLED: [],
  CANCELLED: [],
};

export const canTransition = (from: LifecycleStatus, to: LifecycleStatus) => ALLOWED_TRANSITIONS[from].includes(to);

export const isFinal = (status: LifecycleStatus) => ALLOWED_TRANSITIONS[status].length === 0;

/** Plain-language stage, for timelines and badges. */
export const STAGE_LABEL: Record<LifecycleStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  PENDING: "With the venue",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
};

/** The happy path, in order, for a progress timeline. */
export const LIFECYCLE_PATH: readonly LifecycleStatus[] = ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "SETTLED"];

/** Committed spend: everything not cancelled counts against a budget. */
export const countsTowardSpend = (status: LifecycleStatus) => status !== "CANCELLED";
