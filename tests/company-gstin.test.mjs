import assert from "node:assert/strict";
import test from "node:test";
import { billableGstin, bookingCompanyGstin } from "../lib/companies/gstin.ts";
import { priceQuote } from "../lib/quotes.ts";

const KA_COMPANY = "29AABCN4821K1ZA"; // Karnataka
const DL_COMPANY = "07AAECV6730M1ZX"; // Delhi
const VENUE = "29AADCC1904P1ZF"; // Karnataka

test("billableGstin: a booked company's GSTIN, or a loud failure", () => {
  assert.equal(billableGstin({ legal_name: "Nimbus", gstin: KA_COMPANY }), KA_COMPANY);
  assert.throws(() => billableGstin({ legal_name: "Nimbus", gstin: null }), /Nimbus has no GSTIN yet/);
});

test("bookingCompanyGstin: a registered GSTIN wins; the form's is then a branch GSTIN", () => {
  assert.deepEqual(bookingCompanyGstin(KA_COMPANY, DL_COMPANY), { ok: true, gstin: KA_COMPANY, adopt: false });
  assert.deepEqual(bookingCompanyGstin(KA_COMPANY, ""), { ok: true, gstin: KA_COMPANY, adopt: false });
});

test("bookingCompanyGstin: without one, the form's GSTIN is required, checked and adopted", () => {
  assert.deepEqual(bookingCompanyGstin(null, " 29aabcn4821k1za "), { ok: true, gstin: KA_COMPANY, adopt: true });
  const missing = bookingCompanyGstin(null, "");
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Enter your company's GSTIN/);
  assert.equal(bookingCompanyGstin(null, "29AABCN4821K1ZB").ok, false, "bad checksum");
});

test("a quote before the company has a GSTIN: same total, priced as same-state", () => {
  const without = priceQuote({ listAmount: 100000, taxableValue: 100000, companyGstin: null, venueGstin: VENUE });
  const inter = priceQuote({ listAmount: 100000, taxableValue: 100000, companyGstin: DL_COMPANY, venueGstin: VENUE });
  assert.equal(without.invoice.gst_type, "CGST_SGST");
  assert.equal(without.invoice.invoice_total, inter.invoice.invoice_total);
});
