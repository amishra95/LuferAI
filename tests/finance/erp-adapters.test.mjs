// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildExpenseRequest, EXPENSE_PROVIDERS, isExpenseProvider, PROVIDER_LABEL, providerConnection, taxLines, toMinorUnits } from "../../lib/finance/expense-adapters.ts";
import { receipt, VENUE_MH } from "./fixtures.mjs";

test("six targets, each with a label", () => {
  assert.deepEqual([...EXPENSE_PROVIDERS], ["webhook", "ramp", "brex", "concur", "zoho", "erpnext"]);
  for (const p of EXPENSE_PROVIDERS) assert.ok(PROVIDER_LABEL[p]);
  assert.equal(isExpenseProvider("netsuite"), false);
});

const envOf = (vars) => (k) => vars[k] ?? "";

test("Zoho Expense: Zoho-oauthtoken auth and the organisation header; the older token name still works", () => {
  const env = envOf({ ZOHO_EXPENSE_URL: "https://expense.zoho.com/api/v1/expenses", ZOHO_EXPENSE_AUTH_TOKEN: "1000.abc", ZOHO_EXPENSE_ORGANIZATION_ID: "60001234" });
  assert.deepEqual(providerConnection("zoho", env), {
    url: "https://expense.zoho.com/api/v1/expenses",
    headers: { Authorization: "Zoho-oauthtoken 1000.abc", "X-com-zoho-expense-organizationid": "60001234" },
  });
  assert.deepEqual(providerConnection("zoho", envOf({ ZOHO_EXPENSE_URL: "https://z.example", ZOHO_API_TOKEN: "old" })).headers, { Authorization: "Zoho-oauthtoken old" });
});

test("ERPNext: token <key>:<secret> auth, only with both; the space in the resource URL is encoded", () => {
  const env = envOf({ ERPNEXT_URL: "https://acme.erpnext.com/api/resource/Purchase Invoice", ERPNEXT_API_KEY: "k1", ERPNEXT_API_SECRET: "s1" });
  assert.deepEqual(providerConnection("erpnext", env), { url: "https://acme.erpnext.com/api/resource/Purchase%20Invoice", headers: { Authorization: "token k1:s1" } });
  assert.deepEqual(providerConnection("erpnext", envOf({ ERPNEXT_URL: "https://acme.erpnext.com/x", ERPNEXT_API_KEY: "k1" })).headers, {});
  assert.equal(providerConnection("erpnext", envOf({ ERPNEXT_EXPENSE_URL: "https://old.example" })).url, "https://old.example");
});

test("no URL configured: nothing to send (the export is mocked)", () => {
  for (const p of EXPENSE_PROVIDERS) assert.equal(providerConnection(p, envOf({})).url, "", p);
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

test("Zoho Expense: one itemised expense with GST details and ITC status", () => {
  const r = receipt();
  const { body: e, summary } = buildExpenseRequest("zoho", r);
  assert.match(summary, /^Zoho Expense · The Copper Courtyard · ₹118000\.00$/);
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
