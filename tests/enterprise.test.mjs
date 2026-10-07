import { test } from "node:test";
import assert from "node:assert/strict";

import { validateExpense } from "../lib/bookings/expense.ts";
import { buildExpenseReceipt, RECEIPT_SCHEMA } from "../lib/finance/receipt.ts";
import { calculateGst, computeGstinChecksum } from "../lib/gst-engine.ts";
import { evaluateBookingPolicy } from "../lib/policies/evaluate-booking-policy.ts";
import { fetchPartnersWithin, httpPartnerNetwork, mockPartnerNetwork, partnerToDirectory } from "../lib/venues/partner-network.ts";
import { applyVenueQuery, parseVenueQuery } from "../lib/venues/query.ts";

const NIMBUS = "29AABCN4821K1ZA"; // Karnataka registration
const gstin = (first14) => first14 + computeGstinChecksum(first14);
const NIMBUS_MAHARASHTRA = gstin("27AABCN4821K1Z"); // same PAN, other state
const OTHER_ENTITY = gstin("29AAACZ1234Q1Z");

// --- Expense metadata ----------------------------------------------------------------
test("cost centre is required; codes are normalised to upper case", () => {
  assert.deepEqual(validateExpense({}, NIMBUS), { ok: false, errors: { cost_center: "Enter a cost centre" } });
  const r = validateExpense({ costCenter: " eng-blr ", projectCode: "fy27-sko" }, NIMBUS);
  assert.deepEqual(r, { ok: true, value: { cost_center: "ENG-BLR", project_code: "FY27-SKO", billing_gstin: null } });
});

test("codes reject spaces and symbols", () => {
  const r = validateExpense({ costCenter: "ENG BLR", projectCode: "Q4!" }, NIMBUS);
  assert.equal(r.ok, false);
  assert.match(r.errors.cost_center, /letters, digits/);
  assert.match(r.errors.project_code, /letters, digits/);
});

test("billing GSTIN: another state of the same entity is accepted and stored", () => {
  const r = validateExpense({ costCenter: "ENG-BLR", taxId: NIMBUS_MAHARASHTRA.toLowerCase() }, NIMBUS);
  assert.deepEqual(r, { ok: true, value: { cost_center: "ENG-BLR", project_code: null, billing_gstin: NIMBUS_MAHARASHTRA } });
});

test("billing GSTIN: the company's own registration is stored as null (it's the default)", () => {
  const r = validateExpense({ costCenter: "ENG-BLR", taxId: NIMBUS }, NIMBUS);
  assert.equal(r.ok && r.value.billing_gstin, null);
});

test("billing GSTIN: bad checksum and a different legal entity are rejected", () => {
  const bad = validateExpense({ costCenter: "ENG-BLR", taxId: "29AABCN4821K1ZB" }, NIMBUS);
  assert.match(bad.errors.billing_gstin, /checksum/);
  const other = validateExpense({ costCenter: "ENG-BLR", taxId: OTHER_ENTITY }, NIMBUS);
  assert.match(other.errors.billing_gstin, /different legal entity/);
});

// --- Tiered sign-off ---------------------------------------------------------------------
const policy = { max_budget_per_head: 3000, requires_approval_above: 150000, high_value_threshold: 300000 };
const booking = (headcount, perHead) => ({ headcount, per_head_amount: perHead, total_amount: headcount * perHead });

test("over the approval threshold but under high-value: one tier", () => {
  const r = evaluateBookingPolicy(policy, booking(60, 2600)); // 156,000
  assert.equal(r.requiresApproval, true);
  assert.equal(r.tiers, 1);
});

test("above the high-value threshold: two tiers, with the reason spelled out", () => {
  const r = evaluateBookingPolicy(policy, booking(110, 2800)); // 308,000
  assert.equal(r.tiers, 2);
  assert.match(r.reason, /high-value threshold/);
});

test("high-value alone triggers sign-off even with no ordinary threshold", () => {
  const r = evaluateBookingPolicy({ max_budget_per_head: null, requires_approval_above: null, high_value_threshold: 100000 }, booking(50, 2500));
  assert.deepEqual([r.requiresApproval, r.tiers], [true, 2]);
});

test("no high-value threshold: never two tiers", () => {
  const r = evaluateBookingPolicy({ max_budget_per_head: null, requires_approval_above: 100 }, booking(500, 5000));
  assert.equal(r.tiers, 1);
});

// --- Expense receipt ---------------------------------------------------------------------
test("receipt carries expense metadata, billed GSTIN and the invoice's tax lines", () => {
  const venueGstin = "29AADCC1904P1ZF";
  const invoice = calculateGst({ total_amount: 100000, company_gstin: NIMBUS_MAHARASHTRA, venue_gstin: venueGstin, booking_id: "b1", invoice_date: "2026-11-20" });
  const r = buildExpenseReceipt(
    {
      id: "b1", status: "CONFIRMED", event_date: "2026-11-20", party_size: 40, budget_per_head_inr: 2500, total_amount_inr: 100000,
      notes: null, cost_center: "ENG-BLR", project_code: null, billing_gstin: NIMBUS_MAHARASHTRA, commission_rate: 0.15, commission_inr: 15000,
      company: { id: "c1", legal_name: "Nimbus", gstin: NIMBUS }, venue: { id: "v1", name: "Copper", city: "Bengaluru", gstin: venueGstin }, invoice,
    },
    "2026-10-07T12:00:00.000Z"
  );
  assert.equal(r.schema, RECEIPT_SCHEMA);
  assert.equal(r.buyer.billed_gstin, NIMBUS_MAHARASHTRA);
  assert.equal(r.buyer.registered_gstin, NIMBUS);
  // Maharashtra buyer, Karnataka venue → inter-state IGST.
  assert.equal(r.tax.gst_type, "IGST");
  assert.equal(r.tax.igst, 18000);
  assert.equal(r.tax.invoice_total, 118000);
  assert.deepEqual(r.expense, { cost_center: "ENG-BLR", project_code: null });
});

// --- Federated directory -----------------------------------------------------------------
test("partner listings map to non-bookable directory rows tagged with their supplier", async () => {
  const rows = partnerToDirectory(mockPartnerNetwork, await mockPartnerNetwork.fetchListings());
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(r.tier, "partner");
    assert.equal(r.bookable, false);
    assert.equal(r.supplier, "Bengaluru Venue Exchange");
    assert.match(r.id, /^bvx:/);
  }
});

test("a slow partner network times out to an empty, flagged result", async () => {
  const slow = { id: "slow", name: "Slow Net", fetchListings: () => new Promise((r) => setTimeout(() => r([]), 500)) };
  const res = await fetchPartnersWithin(slow, 30);
  assert.deepEqual(res.venues, []);
  assert.equal(res.status.status, "unavailable");
  assert.match(res.status.error, /timed out/);
});

test("an HTTP feed that breaks the schema is rejected, not trusted", async () => {
  const fakeFetch = async () => new Response(JSON.stringify([{ ref: "X", name: "No capacity" }]), { status: 200 });
  const res = await fetchPartnersWithin(httpPartnerNetwork("https://partners.example/feed", "Ext", fakeFetch), 1000);
  assert.equal(res.status.status, "unavailable");
  assert.match(res.status.error, /schema/);
});

test("directory query filters by tier and sorts missing commission last", async () => {
  const partners = partnerToDirectory(mockPartnerNetwork, await mockPartnerNetwork.fetchListings());
  const internal = [{ id: "i1", tier: "internal", name: "Own", neighborhood: "Indiranagar", city: "Bengaluru", address: "", capacity_max: 80, min_spend_inr: 1, pdr_available: true, gstin: NIMBUS, commission_rate: 0.15, supplier: null, bookable: true }];
  const all = [...internal, ...partners];
  assert.equal(applyVenueQuery(all, parseVenueQuery({ tier: "partner" })).total, partners.length);
  assert.equal(applyVenueQuery(all, parseVenueQuery({ tier: "internal" })).total, 1);
  const byCommission = applyVenueQuery(all, parseVenueQuery({ sort: "commission_rate", dir: "desc", size: "50" })).rows;
  assert.equal(byCommission[0].id, "i1");
  assert.equal(parseVenueQuery({ tier: "bogus" }).tier, "");
});
