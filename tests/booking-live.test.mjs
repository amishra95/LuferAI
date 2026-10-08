import { test } from "node:test";
import assert from "node:assert/strict";
import { diffBookings, statusCounts } from "../lib/bookings/live.ts";

const b = (id, status, venue = "Saffron Terrace", eventDate = "2026-11-06") => ({ id, status, venue, eventDate });

test("diffBookings reports status changes, new and removed bookings", () => {
  const before = [b("1", "PENDING_APPROVAL"), b("2", "PENDING", "The Copper Courtyard", "2026-10-16"), b("3", "CONFIRMED")];
  const after = [b("4", "PENDING", "Olive Room", "2026-12-01"), b("1", "PENDING"), b("2", "CONFIRMED", "The Copper Courtyard", "2026-10-16")];
  assert.deepEqual(diffBookings(before, after), [
    { id: "4", kind: "added", message: "New booking: Olive Room on 1 Dec (with the venue)" },
    { id: "1", kind: "status", message: "Saffron Terrace on 6 Nov is now with the venue" },
    { id: "2", kind: "status", message: "The Copper Courtyard on 16 Oct is now confirmed" },
    { id: "3", kind: "removed", message: "Saffron Terrace on 6 Nov is no longer listed" },
  ]);
  assert.deepEqual(diffBookings(before, before), []);
});

test("statusCounts follows the booking workflow", () => {
  const counts = statusCounts([b("1", "PENDING"), b("2", "PENDING"), b("3", "COMPLETED"), b("4", "CANCELLED")]);
  assert.deepEqual(counts.map((c) => [c.label, c.count]), [["Awaiting sign-off", 0], ["With the venue", 2], ["Confirmed", 0], ["Completed", 1]]);
});
