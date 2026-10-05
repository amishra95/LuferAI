// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRateCard, isRateCardActive } from "../lib/rates/apply-rate-card.ts";
import { findVenueLocks } from "../lib/inventory/venue-locks.ts";
import { formatHoldCountdown, HOLD_HOURS, planHold } from "../lib/inventory/plan-hold.ts";

const card = (overrides = {}) => ({
  id: "card-1",
  discount_percentage: 0,
  custom_per_head_rate: null,
  minimum_spend_override: null,
  effective_from: "2027-01-01",
  effective_to: "2027-06-30",
  ...overrides,
});
const booking = { partySize: 40, perHead: 2500, venueMinSpend: 75000 };

test("rate card active window is inclusive at both ends; null end is open", () => {
  assert.equal(isRateCardActive(card(), "2027-01-01"), true);
  assert.equal(isRateCardActive(card(), "2027-06-30"), true);
  assert.equal(isRateCardActive(card(), "2026-12-31"), false);
  assert.equal(isRateCardActive(card(), "2027-07-01"), false);
  assert.equal(isRateCardActive(card({ effective_to: null }), "2099-01-01"), true);
});

test("no card prices at list", () => {
  const p = applyRateCard(null, booking);
  assert.deepEqual(
    { source: p.source, perHead: p.negotiatedPerHead, total: p.taxableTotal, savings: p.savings, id: p.rateCardId },
    { source: "list", perHead: 2500, total: 100000, savings: 0, id: null }
  );
});

test("percentage discount comes off per head, rounded to paise", () => {
  const p = applyRateCard(card({ discount_percentage: 15 }), booking);
  assert.equal(p.source, "discount");
  assert.equal(p.negotiatedPerHead, 2125);
  assert.equal(p.taxableTotal, 85000);
  assert.equal(p.savings, 15000);

  const odd = applyRateCard(card({ discount_percentage: 12.5 }), { partySize: 3, perHead: 999.99, venueMinSpend: 0 });
  assert.equal(odd.negotiatedPerHead, 874.99); // 874.99125 → 874.99
  assert.equal(odd.taxableTotal, 2624.97);
});

test("custom per-head rate overrides the discount", () => {
  const p = applyRateCard(card({ discount_percentage: 50, custom_per_head_rate: 2200 }), booking);
  assert.equal(p.source, "custom_rate");
  assert.equal(p.negotiatedPerHead, 2200);
  assert.equal(p.taxableTotal, 88000);
});

test("minimum spend override replaces the venue minimum", () => {
  assert.equal(applyRateCard(card({ discount_percentage: 15 }), booking).minimumSpend, 75000);
  const p = applyRateCard(card({ discount_percentage: 15, minimum_spend_override: 90000 }), booking);
  assert.equal(p.minimumSpend, 90000);
  assert.equal(p.meetsMinimumSpend, false); // 85000 < 90000
});

const NOW = new Date("2027-04-01T12:00:00Z");
const hold = (o) => ({ id: "h", booking_id: "b-held", status: "ACTIVE", hold_expires_at: "2027-04-02T00:00:00Z", event_date: "2027-05-01", ...o });
const range = { from: "2027-05-01", to: "2027-05-03" };

test("live hold in range locks the venue", () => {
  const r = findVenueLocks([hold()], [], range, NOW);
  assert.equal(r.available, false);
  assert.deepEqual(r.locks.map((l) => [l.kind, l.date]), [["HOLD", "2027-05-01"]]);
});

test("expired, released, converted and out-of-range holds don't lock", () => {
  const r = findVenueLocks(
    [
      hold({ hold_expires_at: "2027-04-01T11:59:59Z" }),
      hold({ status: "RELEASED" }),
      hold({ status: "CONVERTED" }),
      hold({ event_date: "2027-05-04" }),
    ],
    [],
    range,
    NOW
  );
  assert.equal(r.available, true);
});

test("confirmed bookings lock; pending/cancelled don't; locks sort by date", () => {
  const r = findVenueLocks(
    [hold({ event_date: "2027-05-03" })],
    [
      { id: "b1", status: "CONFIRMED", event_date: "2027-05-02" },
      { id: "b2", status: "PENDING", event_date: "2027-05-01" },
      { id: "b3", status: "CANCELLED", event_date: "2027-05-01" },
    ],
    range,
    NOW
  );
  assert.deepEqual(r.locks.map((l) => [l.kind, l.date]), [["BOOKING", "2027-05-02"], ["HOLD", "2027-05-03"]]);
});

test("excludeBookingId ignores a booking's own hold", () => {
  assert.equal(findVenueLocks([hold()], [], { ...range, excludeBookingId: "b-held" }, NOW).available, true);
});

test("holds last 24h direct, 48h when awaiting internal sign-off", () => {
  const at = new Date("2027-04-01T10:00:00.000Z");
  assert.deepEqual(planHold(false, at), { hours: 24, hold_start: "2027-04-01T10:00:00.000Z", hold_expires_at: "2027-04-02T10:00:00.000Z" });
  assert.equal(planHold(true, at).hold_expires_at, "2027-04-03T10:00:00.000Z");
  assert.deepEqual(HOLD_HOURS, { direct: 24, awaitingApproval: 48 });
});

test("a newly planned hold locks its date until it expires", () => {
  const at = new Date("2027-04-01T10:00:00.000Z");
  const h = { id: "h", booking_id: "b", status: "ACTIVE", event_date: "2027-05-01", ...planHold(false, at) };
  const r = { from: "2027-05-01", to: "2027-05-01" };
  assert.equal(findVenueLocks([h], [], r, new Date("2027-04-02T09:59:00Z")).available, false);
  assert.equal(findVenueLocks([h], [], r, new Date("2027-04-02T10:00:01Z")).available, true);
});

test("countdown rounds down and reports expiry", () => {
  const exp = "2027-04-02T10:00:00.000Z";
  const t = (iso) => new Date(iso).getTime();
  assert.equal(formatHoldCountdown(exp, t("2027-04-01T16:47:30Z")), "17h 12m left");
  assert.equal(formatHoldCountdown(exp, t("2027-04-02T09:15:00Z")), "45m left");
  assert.equal(formatHoldCountdown(exp, t("2027-04-02T09:59:30Z")), "Expired");
  assert.equal(formatHoldCountdown(exp, t("2027-04-03T00:00:00Z")), "Expired");
});
