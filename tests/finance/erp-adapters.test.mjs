// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildExpenseRequest, EXPENSE_PROVIDERS, isExpenseProvider, PROVIDER_LABEL, providerEnv, taxLines, toMinorUnits } from "../../lib/finance/expense-adapters.ts";
import { receipt, VENUE_MH } from "./fixtures.mjs";

test("six targets, each with a label and env names", () => {
  assert.deepEqual([...EXPENSE_PROVIDERS], ["webhook", "ramp", "brex", "concur", "zoho", "erpnext"]);
  for (const p of EXPENSE_PROVIDERS) assert.ok(PROVIDER_LABEL[p]);
  assert.deepEqual(providerEnv("zoho"), { url: "ZOHO_EXPENSE_URL", token: "ZOHO_API_TOKEN" });
  assert.deepEqual(providerEnv("erpnext"), { url: "ERPNEXT_EXPENSE_URL", token: "ERPNEXT_API_TOKEN" });
  assert.equal(isExpenseProvider("netsuite"), false);
});

test("every provider gets the same idempotency key per booking and event", () => {
  const r = receipt();
  const keys = new Set(EXPENSE_PROVIDERS.map((p) => buildExpenseRequest(p, r).idempotencyKey));
  assert.deepEqual([...keys], [`booking.confirmed:${r.booking.id}`]);
});

test("itemised lines: the taxable service on SAC 998596, then each GST head; they add up to the invoice", () => {
  const intra = taxLines(receipt());
  assert.deepEqual(intra.map((l) => [l.head ?? "service", l.amount]), [["service", 100_000], ["CGST", 9000], ["SGST", 9000]]);
  assert.equal(intra[0].sac, "998596");
  const inter = taxLines(receipt({ venueGstin: VENUE_MH }));
  assert.deepEqual(inter.map((l) => [l.head ?? "service", l.amount]), [["service", 100_000], ["IGST", 18_000]]);
  assert.equal(inter.reduce((s, l) => s + l.amount, 0), receipt({ venueGstin: VENUE_MH }).tax.invoice_total);
});

test("SAP Concur: an expense entry with the gross amount, tax and accounting codes", () => {
  const { body } = buildExpenseRequest("concur", receipt());
  assert.equal(body.ExpenseTypeCode, "ENTERTAINMENT");
  assert.equal(body.TransactionAmount, 118_000);
  assert.equal(body.TaxAmount, 18_000);
  assert.equal(body.TransactionCurrencyCode, "INR");
  assert.deepEqual([body.Custom1, body.Custom2], ["ENG-BLR", "Q4-OFFSITE"]);
});

test("Zoho Expense: an itemised report with one expense, GST details and ITC status", () => {
  const r = receipt();
  const { body, summary } = buildExpenseRequest("zoho", r);
  assert.match(summary, /^Zoho Expense · The Copper Courtyard · ₹118000\.00$/);
  assert.equal(body.expenses.length, 1);
  const [e] = body.expenses;
  assert.equal(e.amount, 118_000);
  assert.equal(e.reference_number, r.booking.id);
  assert.equal(e.gst_no, r.supplier.gstin);
  assert.deepEqual([e.source_of_supply, e.destination_of_supply], ["29", "29"]);
  assert.deepEqual(e.line_items.map((l) => l.amount), [100_000, 9000, 9000]);
  assert.equal(e.line_items[0].hsn_or_sac, "998596");
  assert.deepEqual(e.custom_fields, [
    { label: "cost_center", value: "ENG-BLR" },
    { label: "project_code", value: "Q4-OFFSITE" },
    { label: "itc_status", value: "review" },
  ]);
});

test("ERPNext: a draft Purchase Invoice with item, GST tax rows and ITC classification only once decided", () => {
  const pending = buildExpenseRequest("erpnext", receipt()).body;
  assert.equal(pending.doctype, "Purchase Invoice");
  assert.equal(pending.docstatus, 0);
  assert.equal(pending.place_of_supply, "29-Karnataka");
  assert.deepEqual(pending.items, [
    { item_name: "Corporate event", description: pending.items[0].description, qty: 40, rate: 2500, amount: 100_000, gst_hsn_code: "998596", uom: "Nos" },
  ]);
  assert.deepEqual(
    pending.taxes.map((t) => [t.account_head, t.tax_amount]),
    [["Input Tax CGST", 9000], ["Input Tax SGST", 9000]]
  );
  assert.equal("itc_classification" in pending, false);
  assert.match(pending.remarks, /ITC: review/);
  assert.deepEqual([pending.cost_center, pending.project], ["ENG-BLR", "Q4-OFFSITE"]);

  assert.equal(buildExpenseRequest("erpnext", receipt({ itc_decision: "eligible" })).body.itc_classification, "All Other ITC");
  assert.equal(buildExpenseRequest("erpnext", receipt({ itc_decision: "blocked" })).body.itc_classification, "Ineligible");
  const inter = buildExpenseRequest("erpnext", receipt({ venueGstin: VENUE_MH })).body;
  assert.deepEqual(inter.taxes.map((t) => [t.account_head, t.tax_amount]), [["Input Tax IGST", 18_000]]);
});

test("Ramp reports ITC in paise only once eligible", () => {
  assert.equal(buildExpenseRequest("ramp", receipt()).body.tax.itc_eligible, 0);
  assert.equal(buildExpenseRequest("ramp", receipt({ itc_decision: "eligible" })).body.tax.itc_eligible, toMinorUnits(18_000));
});
