// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTrialBooking, committedByMonth } from "../lib/policies/approval-check.ts";
import { NO_RULES, PRESETS } from "../lib/policies/policy-rules.ts";

const co = "co-1";
const trial = (over = {}) => ({ guests: 20, perHead: 2000, date: "2026-12-04", startTime: "19:00", eventType: "team_meal", alcohol: false, entertainment: [], distanceKm: 5, departmentId: null, ...over });
const chain = [{ tier: 1, name: "Asha" }, { tier: 2, name: "Ravi (CFO)" }];
const band = (over = {}) => ({ id: "b1", tenant_id: co, department_id: null, name: "Large events", min_amount_inr: 50000, max_amount_inr: null, approval_levels: 2, sla_hours: 48, is_active: true, ...over });

test("no rules: books instantly, with the total", () => {
  assert.deepEqual(checkTrialBooking(co, NO_RULES, [], chain, trial()), { kind: "instant", total: 40000 });
});

test("Standard: ₹2,000/guest without alcohol in hours books instantly; ₹3,000 needs the manager", () => {
  const rules = PRESETS.standard.rules;
  assert.equal(checkTrialBooking(co, rules, [], chain, trial()).kind, "instant");
  const v = checkTrialBooking(co, rules, [], chain, trial({ perHead: 3000 }));
  assert.equal(v.kind, "approval");
  assert.equal(v.levels, 1);
  assert.deepEqual(v.approvers, [{ level: 1, name: "Asha" }]);
  assert.equal(v.chainShort, false);
});

test("above the manager limit needs two levels: manager then CFO", () => {
  const v = checkTrialBooking(co, PRESETS.standard.rules, [], chain, trial({ perHead: 5000 }));
  assert.equal(v.levels, 2);
  assert.deepEqual(v.approvers.map((a) => a.name), ["Asha", "Ravi (CFO)"]);
});

test("Strict: weekday alcohol can't be booked; weekend alcohol needs approval", () => {
  const blocked = checkTrialBooking(co, PRESETS.strict.rules, [], chain, trial({ perHead: 1000, alcohol: true, date: "2026-12-02" }));
  assert.equal(blocked.kind, "blocked");
  assert.match(blocked.reason, /weekday/);
  assert.equal(checkTrialBooking(co, PRESETS.strict.rules, [], chain, trial({ perHead: 1000, alcohol: true, date: "2026-12-05" })).kind, "approval");
});

test("a spending band adds its levels even when the rules are fine; a team's own band wins", () => {
  const v = checkTrialBooking(co, NO_RULES, [band()], chain, trial({ guests: 30 }));
  assert.equal(v.kind, "approval");
  assert.equal(v.levels, 2);
  const teamBand = band({ id: "b2", department_id: "sales", approval_levels: 1 });
  assert.equal(checkTrialBooking(co, NO_RULES, [band(), teamBand], chain, trial({ guests: 30, departmentId: "sales" })).levels, 1);
  assert.equal(checkTrialBooking(co, NO_RULES, [band({ is_active: false })], chain, trial({ guests: 30 })).kind, "instant");
  assert.equal(checkTrialBooking(co, NO_RULES, [band({ tenant_id: "other" })], chain, trial({ guests: 30 })).kind, "instant");
});

test("a short chain is flagged with the missing level", () => {
  const v = checkTrialBooking(co, PRESETS.standard.rules, [], [{ tier: 1, name: "Asha" }], trial({ perHead: 5000 }));
  assert.equal(v.chainShort, true);
  assert.deepEqual(v.approvers[1], { level: 2, name: null });
});

test("monthly limit uses what's already committed in that month", () => {
  const rules = { ...NO_RULES, monthlyLimit: 100000 };
  const committed = committedByMonth([
    { event_date: "2026-12-01", status: "CONFIRMED", total_amount_inr: "70000" },
    { event_date: "2026-12-10", status: "CANCELLED", total_amount_inr: 90000 },
    { event_date: "2026-11-20", status: "CONFIRMED", total_amount_inr: 90000 },
    { event_date: null, status: "PENDING", total_amount_inr: 5 },
  ]);
  assert.deepEqual(committed, { "2026-12": 70000, "2026-11": 90000 });
  assert.equal(checkTrialBooking(co, rules, [], chain, trial(), committed).kind, "approval");
  assert.equal(checkTrialBooking(co, rules, [], chain, trial({ date: "2027-01-08" }), committed).kind, "instant");
});
