// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Venue reviews: the pure rules (lib/venues/reviews.ts), the rating badge on
// venue cards (lib/venues/signals.ts), and migration 20261107000000 on PGlite:
// completed events only, venue/company taken from the booking, and each side
// reads only its own reviews.
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { isTopRated, parseReviewInput, RATING_MIN_REVIEWS, ratingLabel, venueRatings } from "../lib/venues/reviews.ts";
import { signalLabels, venueSignals } from "../lib/venues/signals.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const COPPER = "aaaaaaaa-0001-4000-8000-000000000001";
const VAULT = "aaaaaaaa-0005-4000-8000-000000000005";
const CONFIRMED_NIMBUS = "bbbbbbbb-0001-4000-8000-000000000001";
const COMPLETED_VERTEX = "bbbbbbbb-0002-4000-8000-000000000002";
const ALICE = "c0000000-0000-4000-8000-000000000001"; // Nimbus
const VICTOR = "c0000000-0000-4000-8000-000000000002"; // Vertex
const HOST = "c0000000-0000-4000-8000-000000000003"; // The Vault
const OTHER_HOST = "c0000000-0000-4000-8000-000000000004"; // The Copper Courtyard

const reviews = (venue_id, ...ratings) => ratings.map((rating) => ({ venue_id, rating }));

test("venueRatings averages per venue and hides venues with too few reviews", () => {
  const map = venueRatings([...reviews("a", 5, 4, 5, 5), ...reviews("b", 5, 5), ...reviews("c", 3, 4, 4)]);
  assert.deepEqual(map.get("a"), { average: 4.8, count: 4 });
  assert.equal(map.has("b"), false, `fewer than ${RATING_MIN_REVIEWS} reviews`);
  assert.deepEqual(map.get("c"), { average: 3.7, count: 3 });
});

test("venueRatings ignores out-of-range ratings", () => {
  assert.equal(venueRatings(reviews("a", 5, 0, 6, 4.5)).has("a"), false);
});

test("top rated from 4.5 up; labels read naturally", () => {
  assert.equal(isTopRated({ average: 4.5, count: 3 }), true);
  assert.equal(isTopRated({ average: 4.4, count: 30 }), false);
  assert.equal(isTopRated(null), false);
  assert.equal(ratingLabel({ average: 4, count: 3 }), "4.0 · 3 reviews");
});

test("parseReviewInput: 1–5 whole stars, optional trimmed comment", () => {
  assert.deepEqual(parseReviewInput("4", "  Great room  "), { ok: true, rating: 4, comment: "Great room" });
  assert.deepEqual(parseReviewInput(5, ""), { ok: true, rating: 5, comment: null });
  assert.deepEqual(parseReviewInput("5", null), { ok: true, rating: 5, comment: null });
  for (const bad of ["0", "6", "3.5", "", null, "x"]) assert.equal(parseReviewInput(bad, "").ok, false, String(bad));
  assert.equal(parseReviewInput(3, "x".repeat(1001)).ok, false);
});

test("the rating badge shows after the favorite badge, with Top rated when earned", () => {
  const ratings = new Map([["v1", { average: 4.7, count: 12 }], ["v2", { average: 4.1, count: 5 }]]);
  const signals = venueSignals([], null, { ratings });
  assert.deepEqual(signalLabels(signals.get("v1")), [{ key: "rated", label: "Top rated · 4.7 · 12 reviews" }]);
  assert.deepEqual(signalLabels(signals.get("v2")), [{ key: "rated", label: "4.1 · 5 reviews" }]);
  assert.equal(signals.get("v3"), undefined);
});

// ----------------------------------------------------------------------------
// Database
// ----------------------------------------------------------------------------

let db;

before(async () => {
  db = await createDatabase();
  await db.query(
    `insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'victor@example.test'), ($3, 'host@example.test'), ($4, 'other@example.test')`,
    [ALICE, VICTOR, HOST, OTHER_HOST]
  );
  await db.query(
    `insert into platform_users (user_id, role, company_id, venue_id, corporate_role) values
       ($1, 'CLIENT', $5, null, 'ORGANIZER'), ($2, 'CLIENT', $6, null, 'ORGANIZER'),
       ($3, 'PROPERTY', null, $7, null), ($4, 'PROPERTY', null, $8, null)`,
    [ALICE, VICTOR, HOST, OTHER_HOST, NIMBUS, VERTEX, VAULT, COPPER]
  );
});

const as = (user, fn) => asUser(db, { claims: { sub: user } }, fn);
const count = async (tx) => Number((await tx.query(`select count(*) n from venue_reviews`)).rows[0].n);

test("migration: only completed events can be reviewed, once each", async () => {
  await assert.rejects(db.query(`insert into venue_reviews (booking_id, venue_id, company_id, rating) values ($1, $2, $3, 5)`, [CONFIRMED_NIMBUS, COPPER, NIMBUS]), /only completed events/);
  await assert.rejects(db.query(`insert into venue_reviews (booking_id, venue_id, company_id, rating) values ($1, $2, $3, 6)`, [COMPLETED_VERTEX, VAULT, VERTEX]), /check constraint/);
});

test("migration: venue and company come from the booking, whatever the caller sends", async () => {
  // Claims the review is for another venue and company; the trigger corrects both.
  const { rows } = await db.query(
    `insert into venue_reviews (booking_id, venue_id, company_id, author_id, rating, comment) values ($1, $2, $3, $4, 4, 'Lovely evening') returning venue_id, company_id`,
    [COMPLETED_VERTEX, COPPER, NIMBUS, VICTOR]
  );
  assert.deepEqual(rows[0], { venue_id: VAULT, company_id: VERTEX });
  await assert.rejects(db.query(`insert into venue_reviews (booking_id, venue_id, company_id, rating) values ($1, $2, $3, 3)`, [COMPLETED_VERTEX, VAULT, VERTEX]), /duplicate key/);
});

test("RLS: the reviewing company and the venue read the review; others and API writes don't", async () => {
  assert.equal(await as(VICTOR, count), 1);
  assert.equal(await as(HOST, count), 1);
  assert.equal(await as(ALICE, count), 0);
  assert.equal(await as(OTHER_HOST, count), 0);
  assert.equal(await asUser(db, { role: "anon" }, count).catch(() => 0), 0);
  await assert.rejects(
    as(VICTOR, (tx) => tx.query(`update venue_reviews set rating = 1 where booking_id = $1`, [COMPLETED_VERTEX])),
    /permission denied/
  );
});
