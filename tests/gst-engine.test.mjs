// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateGst,
  computeGstinChecksum,
  extractStateCode,
  validateGstin,
  determineGstType,
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
