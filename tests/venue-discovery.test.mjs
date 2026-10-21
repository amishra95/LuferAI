// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceKm, officeDistanceLabel, venuePolicyStatus } from "../lib/venues/discovery.ts";

const policy = { max_budget_per_head: 2500, requires_approval_above: 150000 };

test("no policy row: every venue is in policy", () => {
  assert.deepEqual(venuePolicyStatus(null, { from_per_head_inr: 9000, min_spend_inr: 900000 }), { status: "in_policy" });
});

test("cheapest package and minimum spend within limits is in policy; limits are inclusive", () => {
  assert.deepEqual(venuePolicyStatus(policy, { from_per_head_inr: 2500, min_spend_inr: 150000 }), { status: "in_policy" });
});

test("cheapest package over the per-head cap needs approval", () => {
  const r = venuePolicyStatus(policy, { from_per_head_inr: 4200, min_spend_inr: 60000 });
  assert.equal(r.status, "requires_approval");
  assert.match(r.reason, /4,200\/head, over the ₹2,500 cap/);
});

test("minimum spend above the approval threshold needs approval", () => {
  const r = venuePolicyStatus(policy, { from_per_head_inr: 1800, min_spend_inr: 200000 });
  assert.equal(r.status, "requires_approval");
  assert.match(r.reason, /minimum spend is above/);
});

test("unknown package pricing only checks the minimum spend", () => {
  assert.equal(venuePolicyStatus(policy, { from_per_head_inr: null, min_spend_inr: 50000 }).status, "in_policy");
});

test("unset limits are not checked", () => {
  const rules = { max_budget_per_head: null, requires_approval_above: null };
  assert.equal(venuePolicyStatus(rules, { from_per_head_inr: 9000, min_spend_inr: 900000 }).status, "in_policy");
});

test("distanceKm: Indiranagar to UB City is about 4.8 km", () => {
  const km = distanceKm({ latitude: 12.9719, longitude: 77.6411 }, { latitude: 12.9716, longitude: 77.5961 });
  assert.ok(km > 4.7 && km < 4.9, String(km));
});

const office = { latitude: 12.9719, longitude: 77.6411, label: "HQ" };

test("office distance label: metres under 1 km, one decimal under 10 km", () => {
  assert.equal(officeDistanceLabel(office, { latitude: 12.9784, longitude: 77.6408 }), "700 m from HQ");
  assert.equal(officeDistanceLabel(office, { latitude: 12.9716, longitude: 77.5961 }), "4.9 km from HQ");
  assert.equal(officeDistanceLabel(office, office), "50 m from HQ");
});

test("office distance label: none without coordinates, an office, or in another city", () => {
  assert.equal(officeDistanceLabel(null, { latitude: 12.97, longitude: 77.6 }), null);
  assert.equal(officeDistanceLabel(office, { latitude: null, longitude: null }), null);
  assert.equal(officeDistanceLabel(office, { latitude: 19.076, longitude: 72.8777 }), null); // Mumbai
});
