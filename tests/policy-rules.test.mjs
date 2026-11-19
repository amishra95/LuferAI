// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateBookingPolicy } from "../lib/policies/evaluate-booking-policy.ts";
import { matchingPreset, NO_RULES, PolicyRulesInput, PRESETS, rowsFromRules, rulesFromRows, summarizeRules } from "../lib/policies/policy-rules.ts";

const form = (over = {}) => ({
  autoPerHead: "", managerPerHead: "", maxPerHead: "", approvalAbove: "", seniorAbove: "", monthlyLimit: "", maxDistanceKm: "",
  alcohol: "allowed", weekdayAlcohol: "allowed", hoursStart: "", hoursEnd: "", entertainment: [], eventTypes: [], ...over,
});

test("a blank form means no rules: nothing needs approval", () => {
  assert.deepEqual(PolicyRulesInput.parse(form()), NO_RULES);
  assert.deepEqual(summarizeRules(NO_RULES), []);
});

test("amounts parse from text; any whole rupee; blank = no limit; 0 or negative refused", () => {
  const r = PolicyRulesInput.parse(form({ autoPerHead: "1234", managerPerHead: "2999", monthlyLimit: "500000", maxDistanceKm: "7.25" }));
  assert.deepEqual([r.autoPerHead, r.managerPerHead, r.monthlyLimit, r.maxDistanceKm], [1234, 2999, 500000, 7.3]);
  assert.equal(PolicyRulesInput.safeParse(form({ autoPerHead: "0" })).success, false);
  assert.equal(PolicyRulesInput.safeParse(form({ approvalAbove: "-5" })).success, false);
  assert.equal(PolicyRulesInput.safeParse(form({ maxDistanceKm: "0" })).success, false);
});

test("limits must go up: manager ≥ instant, senior ≥ first approval", () => {
  assert.equal(PolicyRulesInput.safeParse(form({ autoPerHead: "3000", managerPerHead: "1500" })).success, false);
  assert.equal(PolicyRulesInput.safeParse(form({ approvalAbove: "100000", seniorAbove: "50000" })).success, false);
  assert.equal(PolicyRulesInput.safeParse(form({ autoPerHead: "3000", managerPerHead: "3000" })).success, true);
});

test("event hours: both or neither, not the same, HH:MM", () => {
  assert.equal(PolicyRulesInput.safeParse(form({ hoursStart: "12:00" })).success, false);
  assert.equal(PolicyRulesInput.safeParse(form({ hoursStart: "12:00", hoursEnd: "12:00" })).success, false);
  assert.equal(PolicyRulesInput.safeParse(form({ hoursStart: "25:00", hoursEnd: "23:00" })).success, false);
  assert.deepEqual(PolicyRulesInput.parse(form({ hoursStart: "18:00:00", hoursEnd: "02:00" })).hoursStart, "18:00");
});

test("unknown entertainment or event types are refused; duplicates dropped", () => {
  assert.equal(PolicyRulesInput.safeParse(form({ entertainment: ["fireworks"] })).success, false);
  assert.equal(PolicyRulesInput.safeParse(form({ eventTypes: ["rave"] })).success, false);
  assert.deepEqual(PolicyRulesInput.parse(form({ entertainment: ["dj", "dj"] })).entertainment, ["dj"]);
});

test("every preset is valid and recognised; an edited preset is custom", () => {
  for (const [key, p] of Object.entries(PRESETS)) {
    assert.equal(PolicyRulesInput.safeParse({ ...p.rules, monthlyLimit: p.rules.monthlyLimit || "" }).success, true, key);
    assert.equal(matchingPreset(p.rules), key);
  }
  assert.equal(matchingPreset({ ...PRESETS.standard.rules, autoPerHead: 2600 }), null);
  assert.equal(matchingPreset({ ...PRESETS.strict.rules, entertainment: ["karaoke", "dj"] }), "strict");
});

test("stored rows round-trip, including time columns and the monthly limit", () => {
  const r = PRESETS.strict.rules;
  const { policy, monthlyLimit } = rowsFromRules({ ...r, monthlyLimit: 800000 });
  assert.deepEqual(rulesFromRows({ ...policy, event_hours_start: "12:00:00", event_hours_end: "22:00:00", restricted_entertainment: [...policy.restricted_entertainment, "unknown"] }, String(monthlyLimit)), { ...r, monthlyLimit: 800000 });
  assert.deepEqual(rulesFromRows(null, null), NO_RULES);
});

test("the summary says what the booking check does", () => {
  const rules = PRESETS.standard.rules;
  const lines = summarizeRules(rules);
  assert.ok(lines.includes("Up to ₹2,500 per guest books instantly, a manager approves up to ₹4,000, the CFO above that."));
  assert.ok(lines.includes("Alcohol needs approval."));
  assert.ok(lines.some((l) => l.includes("12:00–23:00")));
  assert.deepEqual(summarizeRules({ ...NO_RULES, alcohol: "prohibited", weekdayAlcohol: "approval" }), ["Alcohol isn't allowed."]);
  assert.deepEqual(summarizeRules({ ...NO_RULES, weekdayAlcohol: "prohibited" }), ["No alcohol on weekdays (Mon–Fri)."]);

  // And the engine agrees: ₹3,000/guest under Standard needs a manager; ₹2,000 without alcohol in hours doesn't.
  const { policy } = rowsFromRules(rules);
  const base = { total_amount: 40000, headcount: 20, per_head_amount: 2000, alcohol_included: false, entertainment: [], unit: "dinner", event_date: "2026-12-05", event_type: "team_meal", event_start_time: "19:00", distance_from_office_km: 5 };
  assert.equal(evaluateBookingPolicy(policy, base).requiresApproval, false);
  assert.equal(evaluateBookingPolicy(policy, { ...base, per_head_amount: 3000, total_amount: 60000 }).requiresApproval, true);
  assert.equal(evaluateBookingPolicy(policy, { ...base, alcohol_included: true }).requiresApproval, true);
});
