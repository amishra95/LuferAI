import { test } from "node:test";
import assert from "node:assert/strict";
import { autoDecision, checkOffer, lowestAllowedPerHead, NO_RULES, parseRules } from "../lib/rfp/guardrails.ts";
import { findVenueLocks } from "../lib/inventory/venue-locks.ts";
import { minimumSpendRules } from "../lib/guardrails/engine.ts";

const rules = (r) => ({ ...NO_RULES, ...r });

// --- parsing the drawer form ----------------------------------------------------

test("parseRules reads amounts with ₹, commas and % and treats blanks as no limit", () => {
  assert.deepEqual(parseRules({ minSpendFloor: "₹40,000", maxDiscountPct: "10%", autoCounter: true, autoDeclineBelowFloor: true }), {
    ok: true,
    value: { minSpendFloor: 40000, maxDiscountPct: 10, autoCounter: true, autoDeclineBelowFloor: true },
  });
  assert.deepEqual(parseRules({ minSpendFloor: " ", maxDiscountPct: "", autoCounter: false, autoDeclineBelowFloor: false }), { ok: true, value: NO_RULES });
});

test("parseRules rejects out-of-range values and automation without limits", () => {
  assert.equal(parseRules({ minSpendFloor: "-5", maxDiscountPct: "", autoCounter: false, autoDeclineBelowFloor: false }).ok, false);
  assert.equal(parseRules({ minSpendFloor: "", maxDiscountPct: "95", autoCounter: false, autoDeclineBelowFloor: false }).ok, false);
  assert.equal(parseRules({ minSpendFloor: "abc", maxDiscountPct: "", autoCounter: false, autoDeclineBelowFloor: false }).ok, false);
  assert.match(parseRules({ minSpendFloor: "", maxDiscountPct: "10", autoCounter: false, autoDeclineBelowFloor: true }).error, /floor to auto-decline/);
  assert.match(parseRules({ minSpendFloor: "", maxDiscountPct: "", autoCounter: true, autoDeclineBelowFloor: false }).error, /floor or a maximum discount/);
});

// --- limits on offers -------------------------------------------------------------

test("lowestAllowedPerHead takes the stricter of the floor and the discount, rounded up", () => {
  const r = rules({ minSpendFloor: 40000, maxDiscountPct: 10 });
  assert.equal(lowestAllowedPerHead(r, 2000, 40), 1800); // 10% off 2,000 beats 40,000 / 40 = 1,000
  assert.equal(lowestAllowedPerHead(r, 2000, 15), 2667); // 40,000 / 15 = 2,666.67 beats 1,800
  assert.equal(lowestAllowedPerHead(r, null, 40), 1000); // no price to discount from: floor only
  assert.equal(lowestAllowedPerHead(NO_RULES, 2000, 40), 0);
});

test("checkOffer explains floor and discount breaches and allows offers on the line", () => {
  const r = rules({ minSpendFloor: 40000, maxDiscountPct: 10 });
  assert.match(checkOffer(r, { perHead: 900, partySize: 40, standardPerHead: null }), /below your ₹40,000 minimum spend floor/);
  assert.match(checkOffer(r, { perHead: 1700, partySize: 40, standardPerHead: 2000 }), /15\.0% off .* your ceiling is 10%/);
  assert.equal(checkOffer(r, { perHead: 1800, partySize: 40, standardPerHead: 2000 }), null);
  assert.equal(checkOffer(r, { perHead: 1000, partySize: 40, standardPerHead: null }), null);
  assert.equal(checkOffer(NO_RULES, { perHead: 1, partySize: 1, standardPerHead: 5000 }), null);
});

// --- auto-counter on broadcast ----------------------------------------------------

test("autoDecision counters at the client's budget when it fits the guardrails", () => {
  const r = rules({ minSpendFloor: 40000, maxDiscountPct: 10, autoCounter: true });
  assert.deepEqual(autoDecision(r, { standardPerHead: 2000, partySize: 40, budgetPerHead: 1850.6 }), {
    action: "counter",
    perHead: 1850,
    note: "Countered automatically at your budget of ₹1,850 a head.",
  });
});

test("autoDecision leaves the instant quote when the budget is out of reach, within budget, or unknown", () => {
  const r = rules({ minSpendFloor: 40000, maxDiscountPct: 10, autoCounter: true });
  assert.deepEqual(autoDecision(r, { standardPerHead: 2000, partySize: 40, budgetPerHead: 1500 }), { action: "none" }); // 25% off: too far
  assert.deepEqual(autoDecision(r, { standardPerHead: 2000, partySize: 40, budgetPerHead: 2400 }), { action: "none" }); // already within budget
  assert.deepEqual(autoDecision(r, { standardPerHead: 2000, partySize: 40, budgetPerHead: null }), { action: "none" });
  assert.deepEqual(autoDecision(rules({ maxDiscountPct: 10 }), { standardPerHead: 2000, partySize: 40, budgetPerHead: 1900 }), { action: "none" }); // automation off
});

test("autoDecision declines below the floor only when that rule is on", () => {
  const on = rules({ minSpendFloor: 40000, autoDeclineBelowFloor: true });
  const d = autoDecision(on, { standardPerHead: 2000, partySize: 10, budgetPerHead: 1500 });
  assert.equal(d.action, "decline");
  assert.match(d.note, /₹15,000 is below the venue's minimum spend/);
  assert.deepEqual(autoDecision(rules({ minSpendFloor: 40000, autoCounter: true }), { standardPerHead: 2000, partySize: 10, budgetPerHead: 1500 }), { action: "none" });
});

// --- blocked dates lock availability -------------------------------------------------

test("findVenueLocks treats host-blocked dates as locked, even for the excluded booking", () => {
  const blocks = [
    { id: "b1", blocked_date: "2026-11-05", reason: "Maintenance" },
    { id: "b2", blocked_date: "2026-12-01", reason: null },
  ];
  const r = findVenueLocks([], [], { from: "2026-11-01", to: "2026-11-30", excludeBookingId: "x" }, new Date("2026-10-12"), blocks);
  assert.equal(r.available, false);
  assert.deepEqual(r.locks, [{ kind: "BLOCKED", date: "2026-11-05", blockId: "b1", reason: "Maintenance" }]);
  assert.equal(findVenueLocks([], [], { from: "2026-11-06", to: "2026-11-30" }, new Date("2026-10-12"), blocks).available, true);
  // Existing callers that pass no blocks behave as before.
  assert.equal(findVenueLocks([], [], { from: "2026-11-05", to: "2026-11-05" }).available, true);
});

// --- the AI negotiator respects the host floor --------------------------------------

test("minimumSpendRules refuses a minimum spend below the host's floor", () => {
  const denied = minimumSpendRules({ min_spend_inr: 35_000, reason: "win more RFPs" }, { current: 40_000, floor: 38_000 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, "below_host_floor");
  assert.equal(minimumSpendRules({ min_spend_inr: 38_000, reason: "x" }, { current: 40_000, floor: 38_000 }).allowed, true);
  assert.equal(minimumSpendRules({ min_spend_inr: 35_000, reason: "x" }, { current: 40_000 }).allowed, true); // no floor set
});
