/**
 * Change detection for the client portal's live bookings: compares two
 * snapshots of (id, status, venue, date) and describes what changed. Pure, so
 * tests/booking-live.test.mjs can exercise it.
 */

export interface BookingSnapshot {
  id: string;
  status: string;
  venue: string;
  eventDate: string; // YYYY-MM-DD
}

export interface BookingChange {
  id: string;
  kind: "status" | "added" | "removed";
  message: string;
}

const STATUS_TEXT: Record<string, string> = {
  PENDING_APPROVAL: "awaiting sign-off",
  PENDING: "with the venue",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const statusText = (s: string) => STATUS_TEXT[s] ?? s.toLowerCase();
const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const label = (b: BookingSnapshot) => `${b.venue} on ${DAY.format(new Date(`${b.eventDate}T00:00:00Z`))}`;

/** What changed from `before` to `after`, in `after`'s order (removals last). */
export function diffBookings(before: BookingSnapshot[], after: BookingSnapshot[]): BookingChange[] {
  const prev = new Map(before.map((b) => [b.id, b]));
  const next = new Set(after.map((b) => b.id));
  const changes: BookingChange[] = [];
  for (const b of after) {
    const old = prev.get(b.id);
    if (!old) changes.push({ id: b.id, kind: "added", message: `New booking: ${label(b)} (${statusText(b.status)})` });
    else if (old.status !== b.status) changes.push({ id: b.id, kind: "status", message: `${label(b)} is now ${statusText(b.status)}` });
  }
  for (const b of before) if (!next.has(b.id)) changes.push({ id: b.id, kind: "removed", message: `${label(b)} is no longer listed` });
  return changes;
}

/** Counts for the status summary, in workflow order. */
export function statusCounts(bookings: Pick<BookingSnapshot, "status">[]) {
  const count = (s: string) => bookings.filter((b) => b.status === s).length;
  return [
    { status: "PENDING_APPROVAL", label: "Awaiting sign-off", count: count("PENDING_APPROVAL") },
    { status: "PENDING", label: "With the venue", count: count("PENDING") },
    { status: "CONFIRMED", label: "Confirmed", count: count("CONFIRMED") },
    { status: "COMPLETED", label: "Completed", count: count("COMPLETED") },
  ];
}
