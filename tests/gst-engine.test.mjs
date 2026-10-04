// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateGst,
  computeGstinChecksum,
  extractStateCode,
  validateGstin,
  determineGstType,
  todayInIndia,
  stateName,
  partyStateCode,
  splitCommission,
  sumInr,
  GstEngineError,
} from "../lib/gst-engine.ts";

const KA_COMPANY = "29AABCN4821K1ZA"; // Nimbus Analytics (Karnataka)
const DL_COMPANY = "07AAECV6730M1ZX"; // Vertex Capital (Delhi)
const KA_VENUE = "29AADCC1904P1ZF"; // The Copper Courtyard (Bengaluru)

test("checksum matches a known public GSTIN example", () => {
  assert.equal(computeGstinChecksum("27AAPFU0939F1Z"), "V");
});

test("validates seed GSTINs and rejects a bad checksum", () => {
  for (const g of [KA_COMPANY, DL_COMPANY, KA_VENUE]) assert.equal(validateGstin(g).valid, true, g);
  assert.equal(validateGstin("29AABCN4821K1ZB").valid, false);
  assert.equal(validateGstin("99AABCN4821K1ZA").valid, false);
});

test("extracts state codes", () => {
  assert.equal(extractStateCode(KA_COMPANY), "29");
  assert.equal(extractStateCode(DL_COMPANY), "07");
  assert.throws(() => extractStateCode("not-a-gstin"), GstEngineError);
});

test("intra-state → CGST 9% + SGST 9%", () => {
  const inv = calculateGst({ total_amount: 100000, company_gstin: KA_COMPANY, venue_gstin: KA_VENUE });
  assert.equal(inv.gst_type, "CGST_SGST");
  assert.equal(inv.supply_type, "INTRA_STATE");
  assert.equal(inv.tax_breakup.cgst.amount, 9000);
  assert.equal(inv.tax_breakup.sgst.amount, 9000);
  assert.equal(inv.tax_breakup.igst.amount, 0);
  assert.equal(inv.total_tax, 18000);
  assert.equal(inv.invoice_total, 118000);
  assert.equal(inv.sac.code, "998596");
  assert.equal(inv.sac.description, "Corporate Event & Hospitality Procurement Services");
});

test("inter-state → IGST 18%", () => {
  const inv = calculateGst({ total_amount: 120000, company_gstin: DL_COMPANY, venue_gstin: KA_VENUE });
  assert.equal(inv.gst_type, "IGST");
  assert.equal(inv.place_of_supply.state_name, "Delhi");
  assert.equal(inv.tax_breakup.igst.amount, 21600);
  assert.equal(inv.tax_breakup.cgst.amount + inv.tax_breakup.sgst.amount, 0);
  assert.equal(inv.invoice_total, 141600);
});

test("rounds per tax head to the paisa without float drift", () => {
  const inv = calculateGst({ total_amount: 1234.57, company_gstin: KA_COMPANY, venue_gstin: KA_VENUE });
  assert.equal(inv.tax_breakup.cgst.amount, 111.11); // 1234.57 × 9% = 111.1113
  assert.equal(inv.total_tax, 222.22);
  assert.equal(inv.invoice_total, 1456.79);
});

test("determineGstType and amount validation", () => {
  assert.equal(determineGstType(DL_COMPANY, KA_VENUE), "IGST");
  assert.throws(() => calculateGst({ total_amount: -1, company_gstin: KA_COMPANY, venue_gstin: KA_VENUE }), GstEngineError);
});

test("converts INR to paise like numeric(14,2), not via raw float multiplication", () => {
  // 1.005 * 100 === 100.49999999999999 in IEEE-754; Postgres stores 1.005 as 1.01.
  const inv = calculateGst({ total_amount: 1.005, company_gstin: KA_COMPANY, venue_gstin: KA_VENUE });
  assert.equal(inv.taxable_value, 1.01);
  assert.throws(() => calculateGst({ total_amount: 1e12, company_gstin: KA_COMPANY, venue_gstin: KA_VENUE }), GstEngineError);
});

test("default invoice date is the Indian calendar date", () => {
  // 2026-10-03 20:00 UTC is already 2026-10-04 01:30 IST.
  assert.equal(todayInIndia(new Date("2026-10-03T20:00:00Z")), "2026-10-04");
  assert.equal(todayInIndia(new Date("2026-10-03T18:00:00Z")), "2026-10-03");
});

test("commission rounds half-up in exact paise, matching Postgres round()", () => {
  // 1000.10 × 0.15 = 150.015 → 150.02 in SQL; float maths gave 150.01.
  assert.deepEqual(splitCommission(1000.1, 0.15), { commission_rate: 0.15, commission: 150.02, venue_payout: 850.08 });
  assert.deepEqual(splitCommission(100000, 0.15), { commission_rate: 0.15, commission: 15000, venue_payout: 85000 });
  // Paise × rate units exceeds Number.MAX_SAFE_INTEGER here — must still be exact.
  // 999,999,999,999.99 × 0.1234 = 123,399,999,999.998766 → 123,400,000,000.00
  assert.equal(splitCommission(999_999_999_999.99, 0.1234).commission, 123_400_000_000);
  // 999,999,999,999.99 × 0.0001 = 99,999,999.999999 → 100,000,000.00
  assert.equal(splitCommission(999_999_999_999.99, 0.0001).commission, 100_000_000);
  assert.throws(() => splitCommission(1000, 1.5), GstEngineError);
});

test("sums INR in paise without float drift", () => {
  assert.equal(0.1 + 0.2, 0.30000000000000004);
  assert.equal(sumInr([0.1, 0.2]), 0.3);
  assert.equal(sumInr([]), 0);
});

test("display helpers tolerate a null generated state_code", () => {
  assert.equal(stateName(null), "Unknown");
  assert.equal(stateName(undefined), "Unknown");
  assert.equal(stateName("29"), "Karnataka");
  assert.equal(partyStateCode({ gstin: KA_COMPANY, state_code: null }), "29");
  assert.equal(partyStateCode({ gstin: DL_COMPANY, state_code: "07" }), "07");
});
