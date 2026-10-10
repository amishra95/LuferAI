import { test } from "node:test";
import assert from "node:assert/strict";
import { negotiatePerHead, routeBooking, shortlistVenues } from "../lib/bookings/agent-plan.ts";
import { ALLOWED_TRANSITIONS, BOOKING_STATUSES, canTransition, isFinal, LIFECYCLE_PATH } from "../lib/bookings/lifecycle.ts";
import { buildExpenseRequest, EXPENSE_PROVIDERS, providerEnv, toMinorUnits } from "../lib/finance/expense-adapters.ts";
import { buildExpenseReceipt } from "../lib/finance/receipt.ts";
import { calculateGst } from "../lib/gst-engine.ts";
import { ActionError, dispatch, unwrap } from "../lib/mutations/dispatch.ts";
import { createOptimisticState, errorMessage } from "../lib/mutations/optimistic.ts";
import { describePolicyChecks, evaluateBookingPolicy, monthToDateSpend, restrictedIn } from "../lib/policies/evaluate-booking-policy.ts";
import { parseTelemetryEvent, visibleTo } from "../lib/telemetry/events.ts";
import { isStale } from "../lib/telemetry/refresh.ts";
import { refreshSeqFor } from "../lib/telemetry/stream-state.ts";
import {
  describeCancellation,
  isEnterpriseRate,
  minSpendCompliance,
  parseCancellationTerms,
  parseLayouts,
  parseSuites,
  refundFor,
  seatingFor,
} from "../lib/venues/profile.ts";

// ----------------------------------------------------------------------------
// Booking lifecycle
// ----------------------------------------------------------------------------

test("lifecycle: requested → approval → venue → confirmed → completed → settled", () => {
  for (let i = 0; i < LIFECYCLE_PATH.length - 1; i++) assert.ok(canTransition(LIFECYCLE_PATH[i], LIFECYCLE_PATH[i + 1]), `${LIFECYCLE_PATH[i]} → ${LIFECYCLE_PATH[i + 1]}`);
  assert.equal(canTransition("COMPLETED", "SETTLED"), true);
  assert.equal(canTransition("COMPLETED", "CANCELLED"), false); // the event happened
  assert.equal(canTransition("CONFIRMED", "SETTLED"), false); // settle only after the event
  assert.equal(canTransition("PENDING_APPROVAL", "CONFIRMED"), false); // the venue must see it first
  assert.deepEqual(BOOKING_STATUSES.filter(isFinal), ["SETTLED", "CANCELLED"]);
  assert.deepEqual(Object.keys(ALLOWED_TRANSITIONS).sort(), [...BOOKING_STATUSES].sort());
});

// ----------------------------------------------------------------------------
// Spend policy
// ----------------------------------------------------------------------------

const NIMBUS_RULES = { max_budget_per_head: 3000, requires_approval_above: 150000, high_value_threshold: 300000, alcohol_policy: "approval", restricted_entertainment: ["dj", "karaoke"] };
const event = (headcount, perHead, extra = {}) => ({ headcount, per_head_amount: perHead, total_amount: headcount * perHead, ...extra });

test("policy: the existing rules behave as before", () => {
  assert.deepEqual(evaluateBookingPolicy(NIMBUS_RULES, event(40, 2500)), { requiresApproval: false });
  const r = evaluateBookingPolicy(NIMBUS_RULES, event(10, 3500));
  assert.equal(r.requiresApproval, true);
  assert.equal(r.tiers, 1);
  assert.equal(evaluateBookingPolicy(NIMBUS_RULES, event(120, 2600)).tiers, 2); // above the high-value threshold
  assert.deepEqual(evaluateBookingPolicy(null, event(500, 9000)), { requiresApproval: false });
});

test("policy: alcohol — allowed, needs sign-off, or blocked outright", () => {
  assert.equal(evaluateBookingPolicy({ ...NIMBUS_RULES, alcohol_policy: "allowed" }, event(20, 2000, { alcohol_included: true })).requiresApproval, false);
  const approval = evaluateBookingPolicy(NIMBUS_RULES, event(20, 2000, { alcohol_included: true }));
  assert.equal(approval.requiresApproval, true);
  assert.equal(approval.tiers, 1);
  assert.match(approval.reason, /alcohol/);
  const blocked = evaluateBookingPolicy({ ...NIMBUS_RULES, alcohol_policy: "prohibited" }, event(20, 2000, { alcohol_included: true }));
  assert.deepEqual(blocked, { requiresApproval: false, blocked: true, reason: "company policy doesn't allow alcohol at company events" });
  // No alcohol, no rule.
  assert.equal(evaluateBookingPolicy({ ...NIMBUS_RULES, alcohol_policy: "prohibited" }, event(20, 2000)).blocked, undefined);
});

test("policy: restricted entertainment needs sign-off; the rest doesn't", () => {
  assert.deepEqual(restrictedIn(NIMBUS_RULES, ["live_music", "dj", "dj"]), ["dj"]);
  const r = evaluateBookingPolicy(NIMBUS_RULES, event(20, 2000, { entertainment: ["dj", "karaoke"] }));
  assert.equal(r.requiresApproval, true);
  assert.match(r.reason, /a DJ and karaoke/);
  assert.equal(evaluateBookingPolicy(NIMBUS_RULES, event(20, 2000, { entertainment: ["live_music"] })).requiresApproval, false);
});

test("policy: the company-wide monthly limit escalates to senior sign-off, even without a policy row", () => {
  const spend = { monthly_limit: 500000, month_to_date: 420000 };
  const over = evaluateBookingPolicy(NIMBUS_RULES, event(40, 2500), spend); // 100k → 520k
  assert.equal(over.requiresApproval, true);
  assert.equal(over.tiers, 2);
  assert.match(over.reason, /monthly limit/);
  assert.equal(evaluateBookingPolicy(NIMBUS_RULES, event(30, 2500), spend).requiresApproval, false); // 75k → 495k
  assert.equal(evaluateBookingPolicy(null, event(40, 2500), spend).tiers, 2);
  assert.equal(evaluateBookingPolicy(NIMBUS_RULES, event(40, 2500), { monthly_limit: 0, month_to_date: 9e9 }).requiresApproval, false); // 0 = no limit
});

test("policy: reasons combine and the strictest decides the tiers", () => {
  const r = evaluateBookingPolicy(NIMBUS_RULES, event(10, 3500, { alcohol_included: true, entertainment: ["karaoke"] }), { monthly_limit: 100000, month_to_date: 90000 });
  assert.equal(r.tiers, 2);
  assert.equal(r.reason.split("; ").length, 4); // monthly limit, alcohol, karaoke, per-head
});

test("monthToDateSpend counts the company's live bookings in the event's month only", () => {
  const bookings = [
    { id: "1", company_id: "c", event_date: "2026-11-02", status: "CONFIRMED", total_amount_inr: 100000 },
    { id: "2", company_id: "c", event_date: "2026-11-28", status: "PENDING_APPROVAL", total_amount_inr: 50000 },
    { id: "3", company_id: "c", event_date: "2026-11-15", status: "CANCELLED", total_amount_inr: 999999 },
    { id: "4", company_id: "c", event_date: "2026-12-01", status: "CONFIRMED", total_amount_inr: 70000 },
    { id: "5", company_id: "other", event_date: "2026-11-10", status: "CONFIRMED", total_amount_inr: 80000 },
  ];
  assert.equal(monthToDateSpend(bookings, "c", "2026-11-20"), 150000);
  assert.equal(monthToDateSpend(bookings, "c", "2026-11-20", "2"), 100000);
});

test("describePolicyChecks itemises the new rules for approvers", () => {
  const checks = describePolicyChecks(NIMBUS_RULES, { total_amount: 60000, per_head_amount: 2000, alcohol_included: true, entertainment: ["dj"] }, { monthly_limit: 500000, month_to_date: 100000 });
  assert.deepEqual(checks.map((c) => [c.rule, c.ok]), [["monthly_limit", true], ["per_head", true], ["approval_threshold", true], ["alcohol", false], ["entertainment", false]]);
  assert.deepEqual(describePolicyChecks(null, { total_amount: 1, per_head_amount: 1 }), []);
});

// ----------------------------------------------------------------------------
// Venue profile
// ----------------------------------------------------------------------------

test("profile JSON is parsed defensively: malformed entries are dropped", () => {
  assert.deepEqual(parseSuites([{ name: "Vault", seats: 12, min_spend_inr: 60000 }, { name: "", seats: 5, min_spend_inr: 0 }, { name: "X", seats: -1, min_spend_inr: 1 }, "junk"]), [
    { name: "Vault", seats: 12, min_spend_inr: 60000 },
  ]);
  assert.deepEqual(parseLayouts([{ layout: "banquet", capacity: 60 }, { layout: "ballroom", capacity: 500 }, { layout: "cocktail", capacity: 100 }]).map((l) => l.layout), ["cocktail", "banquet"]);
  assert.deepEqual(parseCancellationTerms({ not: "an array" }), []);
  assert.deepEqual(parseCancellationTerms([{ days_before: 7, refund_pct: 50 }, { days_before: 14, refund_pct: 100 }, { days_before: 3, refund_pct: 150 }]), [
    { days_before: 14, refund_pct: 100 },
    { days_before: 7, refund_pct: 50 },
  ]);
});

test("cancellation: refund by notice period, and a readable summary", () => {
  const terms = parseCancellationTerms([{ days_before: 14, refund_pct: 100 }, { days_before: 7, refund_pct: 50 }]);
  assert.deepEqual(refundFor(terms, "2026-11-30", "2026-11-10", 100000), { refundPct: 100, refund: 100000, tier: terms[0] });
  assert.equal(refundFor(terms, "2026-11-30", "2026-11-20", 100000).refund, 50000);
  assert.equal(refundFor(terms, "2026-11-30", "2026-11-28", 100000).refund, 0);
  assert.equal(describeCancellation(terms), "Full refund 14+ days before · 50% refund 7–13 days before · no refund under 7 days");
  assert.equal(describeCancellation([]), "Terms on request");
});

test("minimum spend: the larger of venue-wide and per-guest binds", () => {
  assert.deepEqual(minSpendCompliance({ partySize: 40, perHead: 2000, minimumSpend: 75000, minimumPerHead: 1500 }), { ok: true, total: 80000, required: 75000, shortfall: 0, basis: "total" });
  const perGuest = minSpendCompliance({ partySize: 60, perHead: 1200, minimumSpend: 75000, minimumPerHead: 1500 });
  assert.equal(perGuest.basis, "per_head");
  assert.equal(perGuest.required, 90000);
  assert.equal(perGuest.shortfall, 18000);
  assert.equal(minSpendCompliance({ partySize: 5, perHead: 100, minimumSpend: 0, minimumPerHead: 0 }).basis, "none");
});

test("seating fit and the enterprise rate band", () => {
  const fit = seatingFor(30, parseLayouts([{ layout: "banquet", capacity: 64 }, { layout: "boardroom", capacity: 20 }, { layout: "cocktail", capacity: 80 }]), parseSuites([{ name: "Ember", seats: 24, min_spend_inr: 1 }, { name: "Loft", seats: 40, min_spend_inr: 1 }]));
  assert.deepEqual(fit.layouts.map((l) => l.layout), ["banquet", "cocktail"]);
  assert.deepEqual(fit.suites.map((s) => s.name), ["Loft"]);
  assert.deepEqual([9, 10, 12.5, 15, 16].map(isEnterpriseRate), [false, true, true, true, false]);
});

// ----------------------------------------------------------------------------
// Booking agent planning
// ----------------------------------------------------------------------------

const venue = (id, over = {}) => ({ id, name: id, capacity_max: 80, min_spend_inr: 75000, min_spend_per_head_inr: 0, pdr_available: true, serves_alcohol: true, entertainment: [], ...over });
const request = (over = {}) => ({ venueId: null, eventDate: "2026-11-20", partySize: 40, perHead: 2000, maxPerHead: 2000, alcoholIncluded: false, entertainment: [], privateDining: false, ...over });

test("shortlist: excludes venues that can't host it, and prefers negotiated terms", () => {
  const venues = [
    venue("small", { capacity_max: 20 }),
    venue("dry", { serves_alcohol: false }),
    venue("quiet", { entertainment: [] }),
    venue("big", { capacity_max: 120, entertainment: ["dj"] }),
    venue("snug", { capacity_max: 50, entertainment: ["dj"] }),
    venue("deal", { capacity_max: 200, entertainment: ["dj"] }),
  ];
  const rates = new Map([["deal", { discountPct: 12, customPerHead: null, minimumSpendOverride: null }]]);
  const { shortlist, excluded } = shortlistVenues(venues, request({ alcoholIncluded: true, entertainment: ["dj"] }), rates);
  assert.deepEqual(shortlist.map((s) => s.venue.id), ["deal", "snug", "big"]);
  assert.deepEqual(Object.fromEntries(excluded.map((e) => [e.venue.id, e.reason])), {
    small: "seats up to 20",
    dry: "doesn't serve alcohol",
    quiet: "doesn't offer dj",
  });
  assert.match(shortlist[0].why.join(), /12% company discount/);
  // A named venue is the only candidate.
  assert.deepEqual(shortlistVenues(venues, request({ venueId: "snug" }), rates).shortlist.map((s) => s.venue.id), ["snug"]);
});

test("negotiate: keeps the requested price when it meets the minimums", () => {
  const n = negotiatePerHead(request(), venue("v"), null);
  assert.deepEqual(n, { ok: true, listPerHead: 2000, negotiatedPerHead: 2000, total: 80000, raised: false, note: "list price" });
});

test("negotiate: raises the offer only as far as the minimum, within the ceiling", () => {
  // 40 guests × ₹1,500 = 60k < 75k minimum; with 15% off the list price must be ₹2,206 to net ₹1,875.
  const n = negotiatePerHead(request({ perHead: 1500, maxPerHead: 2500 }), venue("v"), { discountPct: 15, customPerHead: null, minimumSpendOverride: null });
  assert.equal(n.ok, true);
  assert.equal(n.raised, true);
  assert.equal(n.listPerHead, 2206);
  assert.ok(n.total >= 75000);
  assert.ok(n.total - 75000 < 40); // no more than a rupee a head over
  const over = negotiatePerHead(request({ perHead: 1500, maxPerHead: 1800 }), venue("v"), null);
  assert.equal(over.ok, false);
  assert.equal(over.requiredPerHead, 1875);
  assert.match(over.note, /above the ₹1,800 ceiling/);
});

test("negotiate: per-guest minimums and custom company rates", () => {
  assert.equal(negotiatePerHead(request({ perHead: 2000, maxPerHead: 4000 }), venue("v", { min_spend_inr: 0, min_spend_per_head_inr: 3000 }), null).listPerHead, 3000);
  const custom = negotiatePerHead(request(), venue("v"), { discountPct: 0, customPerHead: 1600, minimumSpendOverride: 50000 });
  assert.deepEqual(custom, { ok: true, listPerHead: 2000, negotiatedPerHead: 1600, total: 64000, raised: false, note: "company rate ₹1,600/head" });
  assert.equal(negotiatePerHead(request(), venue("v"), { discountPct: 0, customPerHead: 1600, minimumSpendOverride: null }).ok, false); // 64k < 75k
});

test("routing: the agent confirms only in-policy bookings on pre-agreed terms", () => {
  assert.equal(routeBooking({ requiresApproval: false, internalVenue: true, hasRateCard: true }), "confirm");
  assert.equal(routeBooking({ requiresApproval: false, internalVenue: true, hasRateCard: false }), "venue");
  assert.equal(routeBooking({ requiresApproval: false, internalVenue: false, hasRateCard: true }), "venue");
  assert.equal(routeBooking({ requiresApproval: true, internalVenue: true, hasRateCard: true }), "approval");
});

// ----------------------------------------------------------------------------
// Expense adapters
// ----------------------------------------------------------------------------

const receipt = () => {
  const venueGstin = "29AADCC1904P1ZF";
  const invoice = calculateGst({ total_amount: 100000, company_gstin: "29AABCN4821K1ZA", venue_gstin: venueGstin, booking_id: "b1", invoice_date: "2026-11-20" });
  return buildExpenseReceipt(
    {
      id: "b1", status: "CONFIRMED", event_date: "2026-11-20", party_size: 40, budget_per_head_inr: 2500, total_amount_inr: 100000,
      notes: null, cost_center: "ENG-BLR", project_code: "Q3", billing_gstin: null, commission_rate: 0.15, commission_inr: 15000,
      company: { id: "c1", legal_name: "Nimbus", gstin: "29AABCN4821K1ZA" }, venue: { id: "v1", name: "Copper", city: "Bengaluru", gstin: venueGstin }, invoice,
    },
    "2026-11-21T10:00:00.000Z"
  );
};

test("expense adapters: one receipt, shaped per provider", () => {
  const r = receipt();
  assert.equal(r.tax.invoice_total, 118000);
  const reqs = Object.fromEntries(EXPENSE_PROVIDERS.map((p) => [p, buildExpenseRequest(p, r)]));
  for (const p of EXPENSE_PROVIDERS) assert.equal(reqs[p].idempotencyKey, "booking.confirmed:b1");
  assert.equal(reqs.webhook.body, r);
  assert.deepEqual(reqs.ramp.body.amount, { amount: 11800000, currency_code: "INR" });
  assert.deepEqual(reqs.ramp.body.accounting_field_selections, [{ field: "cost_center", value: "ENG-BLR" }, { field: "project_code", value: "Q3" }]);
  assert.equal(reqs.brex.body.amount.amount, 11800000);
  assert.equal(reqs.brex.body.metadata.cost_center, "ENG-BLR");
  assert.equal(reqs.concur.body.TransactionAmount, 118000);
  assert.equal(reqs.concur.body.Custom1, "ENG-BLR");
  assert.match(reqs.concur.body.Comment, /CGST_SGST/);
  assert.equal(toMinorUnits(0.1 + 0.2), 30);
  assert.deepEqual(providerEnv("ramp"), { url: "RAMP_EXPENSE_URL", token: "RAMP_API_TOKEN" });
  assert.deepEqual(providerEnv("webhook"), { url: "EXPENSE_WEBHOOK_URL", token: "EXPENSE_WEBHOOK_SECRET" });
});

// ----------------------------------------------------------------------------
// Mutations: dispatch, optimistic rollback, events
// ----------------------------------------------------------------------------

test("agent dispatch rollback: a failed dispatch removes the 'working' row and says why", async () => {
  const runs = createOptimisticState([{ key: "old", outcome: { status: "confirmed" } }]);
  const action = () => dispatch("client/dispatchBookingAgent", () => { throw new ActionError("Pick a future date."); });
  const done = runs.mutate({ apply: (l) => [{ key: "new", outcome: null }, ...l], run: async () => unwrap(await action()) });
  assert.deepEqual(runs.view().map((r) => r.key), ["new", "old"]);
  const out = await done;
  assert.equal(errorMessage(out.error), "Pick a future date.");
  assert.deepEqual(runs.view().map((r) => r.key), ["old"]);
});

test("agent dispatch success: the outcome replaces the placeholder (even a 'not booked' one)", async () => {
  const runs = createOptimisticState([]);
  const outcome = { status: "failed", message: "Couldn't book: Copper is booked on 2026-11-20.", steps: [] };
  await runs.mutate({
    apply: (l) => [{ key: "k", outcome: null }, ...l],
    run: async () => unwrap(await dispatch("t", () => outcome)),
    commit: (l, o) => [{ key: "k", outcome: o }, ...l],
  });
  assert.deepEqual(runs.view(), [{ key: "k", outcome }]);
});

test("spend approval rollback: a tier-2 decision before tier 1 snaps back to pending", async () => {
  const decision = createOptimisticState("PENDING");
  const action = () => dispatch("client/approveEventSpend", () => { throw new ActionError("Waiting for tier-1 sign-off from priya@nimbus.example first."); });
  const out = await decision.mutate({ apply: () => "APPROVED", run: async () => unwrap(await action()) });
  assert.equal(decision.view(), "PENDING");
  assert.match(errorMessage(out.error), /tier-1/);
});

test("expense sync: settles a completed booking optimistically; a rejected export rolls back", async () => {
  const row = createOptimisticState({ status: "COMPLETED", expense: { provider: "ramp", status: "failed", attempts: 1 } });
  const p = row.mutate({ apply: (e) => ({ ...e, status: "SETTLED", expense: { ...e.expense, status: "syncing" } }), run: async () => { throw new Error("network"); } });
  assert.equal(row.view().status, "SETTLED");
  await p;
  assert.deepEqual(row.view(), { status: "COMPLETED", expense: { provider: "ramp", status: "failed", attempts: 1 } });
});

test("booking, approval and expense events: parsed, operator-only, and refresh the portals", () => {
  const booking = { seq: 1, at: 1, type: "booking", bookingId: "b1", venueId: "v1", status: "SETTLED", by: "expense" };
  const approval = { seq: 2, at: 2, type: "approval", approvalId: "a1", bookingId: "b1", decision: "APPROVED" };
  const expense = { seq: 3, at: 3, type: "expense", bookingId: "b1", provider: "ramp", status: "mocked" };
  for (const e of [booking, approval, expense]) {
    assert.deepEqual(parseTelemetryEvent(JSON.stringify(e)), e);
    assert.equal(visibleTo(e, { ops: false, venues: true }), false); // tenant data: admins only
  }
  assert.equal(parseTelemetryEvent(JSON.stringify({ ...booking, status: "LOST" })), null);
  assert.equal(parseTelemetryEvent(JSON.stringify({ ...approval, decision: "MAYBE" })), null);
  assert.equal(isStale("/client/approvals", [approval]), true);
  assert.equal(isStale("/property", [booking]), true);
  assert.equal(isStale("/venues", [expense]), false);
  // An open venue inspector reloads when one of its bookings moves.
  assert.equal(refreshSeqFor([booking], "venue", "v1"), 1);
  assert.equal(refreshSeqFor([booking], "venue", "v2"), 0);
});
