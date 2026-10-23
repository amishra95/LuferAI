// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Venue card signals (lib/venues/signals.ts): coworkers, company favorites and
// response times; and the cross-company response-time loader
// (lib/venues/signals-store.ts) on the in-memory store.
import "./support/server-actions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAST_RESPONSE_HOURS,
  FAVORITE_MIN_BOOKINGS,
  RESPONSE_MIN_SAMPLES,
  signalLabels,
  venueResponseMedians,
  venueSignals,
} from "../lib/venues/signals.ts";

const { venueResponseHours } = await import("../lib/venues/signals-store.ts");
const { mutateDb } = await import("../lib/data/local-store.ts");

const NOW = Date.parse("2026-10-23T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();
const ME = "user-me";
const booking = (venue_id, requested_by, { status = "CONFIRMED", ago = 10 } = {}) => ({ venue_id, requested_by, status, event_date: daysAgo(ago).slice(0, 10), created_at: daysAgo(ago) });

test("coworkers: distinct colleagues who booked here, not counting the viewer", () => {
  const s = venueSignals([booking("v1", "asha"), booking("v1", "asha"), booking("v1", "ravi"), booking("v1", ME)], ME, new Map(), NOW).get("v1");
  assert.equal(s.coworkers, 2);
  assert.equal(s.youBooked, true);
  // Four bookings also make it a company favorite.
  assert.deepEqual(signalLabels(s).map((l) => l.label), ["Company favorite", "Booked by 2 coworkers", "You've booked here"]);
  assert.equal(signalLabels({ ...s, coworkers: 1, youBooked: false, companyFavorite: false })[0].label, "Booked by a coworker");
});

test("only bookings that went ahead, in the last year, count", () => {
  const s = venueSignals(
    [booking("v1", "asha", { status: "CANCELLED" }), booking("v1", "ravi", { status: "PENDING_APPROVAL" }), booking("v1", "meera", { ago: 400 }), booking("v1", "dev", { status: "SETTLED" }), booking("v1", "kai", { status: "COMPLETED" })],
    ME,
    new Map(),
    NOW
  ).get("v1");
  assert.equal(s.coworkers, 2);
});

test("bookings without a recorded requester count for favorites but not as coworkers", () => {
  const s = venueSignals([booking("v1", null), booking("v1", null), booking("v1", null)], ME, new Map(), NOW).get("v1");
  assert.deepEqual([s.coworkers, s.companyFavorite], [0, true]);
});

test("company favorites: the top venues with enough bookings, most booked first, recent wins ties", () => {
  assert.equal(FAVORITE_MIN_BOOKINGS, 3);
  const many = (venue, n, ago = 10) => Array.from({ length: n }, (_, i) => booking(venue, `u${i}`, { ago: ago + i }));
  const signals = venueSignals([...many("a", 6), ...many("b", 5), ...many("c", 4, 50), ...many("d", 4, 5), ...many("e", 2)], ME, new Map(), NOW);
  const favorites = [...signals].filter(([, s]) => s.companyFavorite).map(([v]) => v).sort();
  // a (6), b (5), then d beats c on recency; e has too few.
  assert.deepEqual(favorites, ["a", "b", "d"]);
  assert.equal(signals.get("e").companyFavorite, false);
});

test("a signed-in admin (no viewer) sees coworker counts without 'you'", () => {
  const s = venueSignals([booking("v1", "asha"), booking("v1", ME)], null, new Map(), NOW).get("v1");
  assert.deepEqual([s.coworkers, s.youBooked], [2, false]);
});

test("response times: the median, rounded up to the hour, only with enough samples", () => {
  assert.equal(RESPONSE_MIN_SAMPLES, 3);
  const at = (venue, hoursAgoReached, hoursToAccept) => {
    const reached = NOW - hoursAgoReached * 3_600_000;
    return { venue_id: venue, reached_venue_at: new Date(reached).toISOString(), venue_accepted_at: new Date(reached + hoursToAccept * 3_600_000).toISOString() };
  };
  const medians = venueResponseMedians([at("fast", 100, 0.5), at("fast", 90, 1.5), at("fast", 80, 9), at("even", 50, 1), at("even", 40, 2), at("even", 30, 3), at("even", 20, 4), at("few", 10, 1), at("few", 5, 1)], NOW);
  assert.equal(medians.get("fast"), 2);
  assert.equal(medians.get("even"), 3, "median of 1, 2, 3, 4 h is 2.5 h, read as within 3 h");
  assert.equal(medians.has("few"), false);
});

test("response times ignore impossible and old samples", () => {
  const good = { venue_id: "v", reached_venue_at: daysAgo(3), venue_accepted_at: daysAgo(2.95) };
  const medians = venueResponseMedians(
    [good, good, good, { venue_id: "v", reached_venue_at: daysAgo(1), venue_accepted_at: daysAgo(2) }, { venue_id: "v", reached_venue_at: "nope", venue_accepted_at: daysAgo(1) }, { venue_id: "old", reached_venue_at: daysAgo(500), venue_accepted_at: daysAgo(499) }],
    NOW
  );
  assert.deepEqual([...medians.keys()], ["v"]);
});

test("only quick venues get the badge, even with no bookings by the company", () => {
  const signals = venueSignals([], ME, new Map([["quick", 2], ["slow", FAST_RESPONSE_HOURS + 1]]), NOW);
  assert.deepEqual(signalLabels(signals.get("quick")), [{ key: "fast", label: "Usually confirms within 2 h" }]);
  assert.deepEqual(signalLabels(signals.get("slow")), []);
  assert.deepEqual(signalLabels(undefined), []);
});

test("favorite comes first among the badges", () => {
  assert.deepEqual(signalLabels({ coworkers: 3, youBooked: true, companyFavorite: true, confirmsWithinHours: 1 }).map((l) => l.key), ["favorite", "coworkers", "you", "fast"]);
});

test("loader: response time runs from the last approval when the booking needed one, else from the request", async () => {
  const venue = "cccccccc-9999-4000-8000-000000000001";
  const base = Date.now() - 2 * 86_400_000;
  const iso = (h) => new Date(base + h * 3_600_000).toISOString();
  await mutateDb((db) => {
    const template = db.bookings[0];
    db.bookings.push(
      // Accepted 1 h after it was made (no sign-off needed).
      { ...template, id: "bbbbbbbb-9999-4000-8000-000000000001", venue_id: venue, status: "CONFIRMED", created_at: iso(0), venue_accepted_at: iso(1) },
      { ...template, id: "bbbbbbbb-9999-4000-8000-000000000002", venue_id: venue, status: "CONFIRMED", created_at: iso(0), venue_accepted_at: iso(2) },
      // Made at 0, approved at 20 h, accepted at 22 h: 2 h for the venue, not 22.
      { ...template, id: "bbbbbbbb-9999-4000-8000-000000000003", venue_id: venue, status: "CONFIRMED", created_at: iso(0), venue_accepted_at: iso(22) }
    );
    db.approvals.push({
      id: "aaaaaaaa-9999-4000-8000-000000000003",
      tenant_id: template.company_id,
      booking_id: "bbbbbbbb-9999-4000-8000-000000000003",
      catalog_order_id: null,
      requested_by: template.requested_by ?? "x",
      approver_id: "y",
      reason: null,
      status: "APPROVED",
      decision_note: null,
      decided_at: iso(20),
      step: 1,
      activated_at: iso(0),
      due_at: null,
      escalated_from: null,
      rule_id: null,
      created_at: iso(0),
      updated_at: iso(20),
    });
  });
  const hours = await venueResponseHours();
  assert.equal(hours.get(venue), 2);
});
