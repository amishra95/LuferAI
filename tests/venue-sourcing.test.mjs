// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchVenues, venueSearchSchema } from "../lib/ai/venue-sourcing.ts";

const venue = (id, overrides) => ({
  id,
  name: id,
  city: "Bengaluru",
  neighborhood: "Indiranagar",
  address: "12th Main, Indiranagar, Bengaluru",
  capacity_max: 80,
  min_spend_inr: 50000,
  pdr_available: false,
  ...overrides,
});

const venues = [
  venue("copper", { capacity_max: 80, min_spend_inr: 75000, pdr_available: true }),
  venue("saffron", { capacity_max: 140, min_spend_inr: 60000 }),
  venue("vault", { neighborhood: "UB City", address: "UB City, Bengaluru", capacity_max: 60, min_spend_inr: 250000, pdr_available: true }),
];
const policy = { max_budget_per_head: 3000, requires_approval_above: 150000 };
const filters = (f) => ({ location: "", minCapacity: 40, maxBudgetPerHead: 2500, features: [], ...f });
const ids = (opts) => opts.map((o) => o.venue.id);

test("schema accepts the shape the routes expect", () => {
  assert.ok(venueSearchSchema.safeParse(filters({})).success);
  assert.equal(venueSearchSchema.safeParse(filters({ minCapacity: 0 })).success, false);
});

test("location matches neighbourhood case-insensitively; empty means anywhere", () => {
  assert.deepEqual(ids(matchVenues(venues, filters({ location: "ub city", maxBudgetPerHead: 0 }), null)), ["vault"]);
  assert.equal(matchVenues(venues, filters({ maxBudgetPerHead: 0 }), null).length, 3);
});

test("capacity filter drops venues too small for the group", () => {
  assert.deepEqual(ids(matchVenues(venues, filters({ minCapacity: 100, maxBudgetPerHead: 0 }), null)), ["saffron"]);
});

test("private dining is matched on pdr_available; other features are reported unverified", () => {
  const opts = matchVenues(venues, filters({ maxBudgetPerHead: 0, features: ["Private dining room", "projector"] }), null);
  assert.deepEqual(ids(opts).sort(), ["copper", "vault"]);
  assert.deepEqual(opts[0].unverifiedFeatures, ["projector"]);
});

test("venues whose minimum spend the budget can't reach are dropped", () => {
  // 40 × 2500 = 100000: copper (75k) and saffron (60k) fit, vault (250k) doesn't.
  assert.deepEqual(ids(matchVenues(venues, filters({}), policy)).sort(), ["copper", "saffron"]);
});

test("labels follow the tenant policy, using the venue's minimum spend when it's higher", () => {
  // No budget given, 20 guests at copper: its 75000 minimum works out to 3750 a head > 3000 cap.
  const small = matchVenues([venues[0]], filters({ minCapacity: 20, maxBudgetPerHead: 0 }), policy)[0];
  assert.equal(small.label, "Requires Manager Approval");
  assert.equal(small.estimatedPerHead, 3750);
  assert.equal(small.estimatedTotal, 75000);
  assert.match(small.policyReason, /per head exceeds/);

  // 30 guests × 2800 = 84000 is above copper's 75000 minimum, so the budget sets the price: compliant.

  const ok = matchVenues([venues[0]], filters({ minCapacity: 30, maxBudgetPerHead: 2800 }), policy)[0];
  assert.equal(ok.label, "Policy Compliant");
  assert.equal(ok.estimatedTotal, 84000);
});

test("no policy means every option is compliant; compliant options sort first", () => {
  assert.ok(matchVenues(venues, filters({ maxBudgetPerHead: 0 }), null).every((o) => o.label === "Policy Compliant"));
  const mixed = matchVenues(venues, filters({ minCapacity: 60, maxBudgetPerHead: 2600 }), policy);
  // 60 × 2600 = 156000 > 150000 threshold for all; ordering then by capacity.
  assert.ok(mixed.every((o) => o.label === "Requires Manager Approval"));
  assert.deepEqual(ids(mixed), ["copper", "saffron"]);
});
