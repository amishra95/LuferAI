// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";

import { calculateGst, determineGstType, SAC_CODE, validateGstin } from "../../lib/gst-engine.ts";
import { isInvoiced, itcClaimable, itcStatusOf, itcTags, summariseItc } from "../../lib/finance/itc.ts";
import { booking, NIMBUS_KA, NIMBUS_MH, OTHER_CO, receipt, VENUE_KA, VENUE_MH } from "./fixtures.mjs";

// --- GSTINs and SAC 998596 tax -------------------------------------------------------

test("GSTIN validation: checksum, format and state", () => {
  for (const g of [NIMBUS_KA, NIMBUS_MH, VENUE_KA, VENUE_MH]) assert.equal(validateGstin(g).valid, true, g);
  assert.equal(validateGstin(NIMBUS_KA.slice(0, 14) + (NIMBUS_KA[14] === "A" ? "B" : "A")).valid, false);
  assert.equal(validateGstin("29AABCN4821K1Z").valid, false);
  assert.equal(validateGstin("99AABCN4821K1ZA").valid, false);
});

test("same state → CGST 9% + SGST 9%; different state → IGST 18%; on SAC 998596", () => {
  const intra = calculateGst({ total_amount: 100_000, company_gstin: NIMBUS_KA, venue_gstin: VENUE_KA });
  assert.equal(intra.gst_type, "CGST_SGST");
  assert.equal(intra.supply_type, "INTRA_STATE");
  assert.deepEqual([intra.tax_breakup.cgst.amount, intra.tax_breakup.sgst.amount, intra.tax_breakup.igst.amount], [9000, 9000, 0]);
  assert.equal(intra.invoice_total, 118_000);
  assert.equal(intra.sac.code, SAC_CODE);
  assert.equal(SAC_CODE, "998596");

  const inter = calculateGst({ total_amount: 100_000, company_gstin: NIMBUS_KA, venue_gstin: VENUE_MH });
  assert.equal(inter.gst_type, "IGST");
  assert.deepEqual([inter.tax_breakup.cgst.amount, inter.tax_breakup.sgst.amount, inter.tax_breakup.igst.amount], [0, 0, 18000]);
  assert.equal(inter.invoice_total, 118_000);
});

test("billing a branch in another state switches the tax type (place of supply follows the billed GSTIN)", () => {
  assert.equal(determineGstType(NIMBUS_KA, VENUE_KA), "CGST_SGST");
  assert.equal(determineGstType(NIMBUS_MH, VENUE_KA), "IGST");
  const inv = calculateGst({ total_amount: 50_000, company_gstin: NIMBUS_MH, venue_gstin: VENUE_KA });
  assert.equal(inv.place_of_supply.state_code, "27");
  assert.equal(inv.tax_breakup.igst.amount, 9000);
});

test("paise-exact: CGST + SGST always add up to the total tax", () => {
  for (const amount of [1, 33.33, 999.99, 12_345.67, 1_00_00_000.01]) {
    const inv = calculateGst({ total_amount: amount, company_gstin: NIMBUS_KA, venue_gstin: VENUE_KA });
    assert.equal(Math.round((inv.tax_breakup.cgst.amount + inv.tax_breakup.sgst.amount) * 100), Math.round(inv.total_tax * 100), String(amount));
    assert.equal(Math.round((inv.taxable_value + inv.total_tax) * 100), Math.round(inv.invoice_total * 100));
  }
});

// --- ITC status --------------------------------------------------------------------------

const itc = (o = {}) => ({ status: "COMPLETED", itc_decision: null, company_gstin: NIMBUS_KA, billed_gstin: null, venue_gstin: VENUE_KA, ...o });

test("ITC is never assumed: invoiced bookings wait for finance's review", () => {
  assert.equal(itcStatusOf(itc()), "review");
  assert.equal(itcStatusOf(itc({ status: "CONFIRMED" })), "awaiting_invoice");
  assert.equal(itcStatusOf(itc({ status: "SETTLED" })), "review");
  assert.equal(isInvoiced("CONFIRMED"), false);
});

test("ITC follows finance's decision; cancelled bookings have none", () => {
  assert.equal(itcStatusOf(itc({ itc_decision: "eligible" })), "eligible");
  assert.equal(itcStatusOf(itc({ itc_decision: "blocked" })), "blocked");
  assert.equal(itcStatusOf(itc({ status: "CANCELLED", itc_decision: "eligible" })), "not_applicable");
});

test("ITC not eligible outright when billed to another legal entity or the supplier GSTIN is invalid", () => {
  // Same PAN, other state: still the company's own GSTIN.
  assert.equal(itcStatusOf(itc({ billed_gstin: NIMBUS_MH })), "review");
  assert.equal(itcStatusOf(itc({ billed_gstin: OTHER_CO, itc_decision: "eligible" })), "not_eligible");
  assert.equal(itcStatusOf(itc({ venue_gstin: "29AAFCV1234M1Z0" })), "not_eligible");
});

test("claimable credit: the full GST once eligible, nothing otherwise", () => {
  assert.equal(itcClaimable("eligible", 18_000), 18_000);
  for (const s of ["blocked", "review", "awaiting_invoice", "not_eligible", "not_applicable"]) assert.equal(itcClaimable(s, 18_000), 0, s);
});

test("compliance tags: GSTIN match, supplier GSTIN, SAC, supply type, status", () => {
  assert.deepEqual(itcTags({ ...itc(), sac_code: "998596", gst_type: "CGST_SGST" }), ["GSTIN_MATCH", "SUPPLIER_GSTIN_VALID", "SAC_998596", "INTRA_STATE_CGST_SGST", "ITC_PENDING_REVIEW"]);
  assert.deepEqual(itcTags({ ...itc({ billed_gstin: OTHER_CO }), sac_code: "998596", gst_type: "IGST" }), [
    "GSTIN_MISMATCH",
    "SUPPLIER_GSTIN_VALID",
    "SAC_998596",
    "INTER_STATE_IGST",
    "ITC_NOT_ELIGIBLE",
  ]);
  assert.ok(itcTags({ ...itc({ itc_decision: "eligible" }), sac_code: "998596", gst_type: "CGST_SGST" }).includes("ITC_ELIGIBLE"));
});

test("summary: GST per status; only confirmed credit counts as claimable; cancelled excluded", () => {
  const row = (o) => ({ ...itc(o), total_tax: 1800, total_amount_inr: 10_000 });
  assert.deepEqual(
    summariseItc([
      row({ itc_decision: "eligible" }),
      row({}),
      row({ status: "CONFIRMED" }),
      row({ itc_decision: "blocked" }),
      row({ billed_gstin: OTHER_CO }),
      row({ status: "CANCELLED" }),
    ]),
    { eligible: 1800, pendingReview: 1800, awaitingInvoice: 1800, blocked: 3600, committedSpend: 50_000 }
  );
});

// --- the receipt finance systems receive ---------------------------------------------------

test("receipt: ITC amount is 0 until finance confirms; status and tags travel with it", () => {
  const pending = receipt();
  assert.equal(pending.tax.itc_status, "review");
  assert.equal(pending.tax.itc_eligible_amount, 0);
  assert.ok(pending.tax.itc_tags.includes("ITC_PENDING_REVIEW"));

  const eligible = receipt({ itc_decision: "eligible" });
  assert.equal(eligible.tax.itc_eligible_amount, eligible.tax.total_tax);
  assert.equal(eligible.tax.total_tax, 18_000);
  assert.equal(booking().invoice.total_tax, 18_000);
});
