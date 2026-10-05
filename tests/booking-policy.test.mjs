// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateBookingPolicy } from "../lib/policies/evaluate-booking-policy.ts";

const policy = { max_budget_per_head: 3000, requires_approval_above: 150000 };
const booking = (headcount, perHead) => ({ headcount, per_head_amount: perHead, total_amount: headcount * perHead });

test("within both limits needs no approval", () => {
  assert.deepEqual(evaluateBookingPolicy(policy, booking(40, 3000)), { requiresApproval: false });
});

test("limits are exclusive: exactly at the cap and threshold passes", () => {
  assert.equal(evaluateBookingPolicy(policy, booking(50, 3000)).requiresApproval, false); // 150000 total
});

test("per-head over the cap requires approval", () => {
  const r = evaluateBookingPolicy(policy, booking(10, 3500));
  assert.equal(r.requiresApproval, true);
  assert.match(r.reason, /per head exceeds/);
  assert.doesNotMatch(r.reason, /approval threshold/);
});

test("total over the threshold requires approval", () => {
  const r = evaluateBookingPolicy(policy, booking(60, 2600)); // 156000
  assert.equal(r.requiresApproval, true);
  assert.match(r.reason, /60 guests is above/);
  assert.doesNotMatch(r.reason, /per head/);
});

test("both breaches are reported together", () => {
  const r = evaluateBookingPolicy(policy, booking(60, 4000));
  assert.equal(r.requiresApproval, true);
  assert.equal(r.reason.split("; ").length, 2);
});

test("null limits and missing policy never require approval", () => {
  const open = { max_budget_per_head: null, requires_approval_above: null };
  assert.equal(evaluateBookingPolicy(open, booking(500, 99999)).requiresApproval, false);
  assert.equal(evaluateBookingPolicy(null, booking(500, 99999)).requiresApproval, false);
});

test("only the per-head rule applies when the threshold is null", () => {
  const capOnly = { max_budget_per_head: 3000, requires_approval_above: null };
  assert.equal(evaluateBookingPolicy(capOnly, booking(500, 3000)).requiresApproval, false);
  assert.equal(evaluateBookingPolicy(capOnly, booking(1, 3001)).requiresApproval, true);
});

test("describePolicyChecks itemises the same rules evaluateBookingPolicy applies", async () => {
  const { describePolicyChecks, evaluateBookingPolicy } = await import("../lib/policies/evaluate-booking-policy.ts");
  const rules = { max_budget_per_head: 2500, requires_approval_above: 150000 };
  const input = { total_amount: 160000, headcount: 40, per_head_amount: 4000 };
  const checks = describePolicyChecks(rules, input);
  assert.deepEqual(checks.map((c) => [c.rule, c.ok]), [["per_head", false], ["approval_threshold", false]]);
  assert.equal(evaluateBookingPolicy(rules, input).requiresApproval, true);
  assert.deepEqual(describePolicyChecks({ max_budget_per_head: null, requires_approval_above: null }, input), []);
  assert.deepEqual(describePolicyChecks(null, input), []);
});
