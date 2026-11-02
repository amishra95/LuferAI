// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMonthlyStatement,
  isStatementMonth,
  monthLabel,
  previousMonth,
  renderStatementHtml,
  statementCsv,
  statementNumber,
} from "../../lib/finance/monthly-statement.ts";

const company = { id: "1a2b3c4d-0000-4000-8000-000000000001", legal_name: "Acme Private Limited", gstin: "29AAAAA0000A1Z5" };
const venueA = { id: "v-a", name: "Toit Indiranagar", city: "Bengaluru", gstin: "29BBBBB1111B1Z5" };
const venueB = { id: "v-b", name: "Taj Lands End", city: "Mumbai", gstin: "27CCCCC2222C1Z5" };

const intra = (taxable) => ({
  invoice_number: null,
  gst_type: "CGST_SGST",
  taxable_value: taxable,
  tax_breakup: { cgst: { amount: taxable * 0.09 }, sgst: { amount: taxable * 0.09 }, igst: { amount: 0 } },
  total_tax: taxable * 0.18,
  invoice_total: taxable * 1.18,
});
const inter = (taxable) => ({
  invoice_number: "TLE/26-27/0042",
  gst_type: "IGST",
  taxable_value: taxable,
  tax_breakup: { cgst: { amount: 0 }, sgst: { amount: 0 }, igst: { amount: taxable * 0.18 } },
  total_tax: taxable * 0.18,
  invoice_total: taxable * 1.18,
});
const booking = (id, venue, event_date, invoice, status = "CONFIRMED") => ({ id, status, event_date, party_size: 20, cost_center: "SALES-01", project_code: null, venue, invoice });

const bookings = [
  booking("b1", venueA, "2026-10-05", intra(10000)),
  booking("b2", venueA, "2026-10-20", intra(5000), "COMPLETED"),
  booking("b3", venueB, "2026-10-12", inter(50000), "SETTLED"),
  booking("b4", venueA, "2026-10-25", intra(9999), "PENDING_APPROVAL"), // not confirmed
  booking("b5", venueA, "2026-11-01", intra(7000)), // next month
  booking("b6", venueB, "2026-09-30", inter(7000)), // previous month
];

test("month helpers", () => {
  assert.ok(isStatementMonth("2026-10"));
  assert.ok(!isStatementMonth("2026-13"));
  assert.ok(!isStatementMonth("2026-1"));
  assert.equal(previousMonth("2026-11-01"), "2026-10");
  assert.equal(previousMonth("2027-01-01"), "2026-12");
  assert.equal(monthLabel("2026-10"), "October 2026");
  assert.equal(statementNumber(company.id, "2026-10"), "ST-202610-1A2B3C4D");
});

test("statement: confirmed bookings in the month, grouped by vendor, with one balance due", () => {
  const s = buildMonthlyStatement({
    company,
    month: "2026-10",
    bookings,
    payments: [
      { booking_id: "b3", status: "captured", amount_inr: 59000 }, // fully paid
      { booking_id: "b1", status: "captured", amount_inr: 2000 }, // deposit
      { booking_id: "b1", status: "authorized", amount_inr: 9000 }, // not money received
      { booking_id: "b2", status: "captured", amount_inr: 999999 }, // overpayment capped at the line total
    ],
  });
  assert.equal(s.bookingCount, 3);
  assert.deepEqual(s.vendors.map((v) => v.name), ["Taj Lands End", "Toit Indiranagar"]); // biggest first
  const toit = s.vendors[1];
  assert.deepEqual(toit.lines.map((l) => l.bookingId), ["b1", "b2"]); // by date
  assert.equal(toit.total, 17700);
  assert.equal(toit.due, 9800); // 11800 − 2000 deposit, b2 fully covered
  assert.equal(s.totals.taxable, 65000);
  assert.equal(s.totals.cgst, 1350);
  assert.equal(s.totals.igst, 9000);
  assert.equal(s.totals.tax, 11700);
  assert.equal(s.totals.total, 76700);
  assert.equal(s.totals.paid, 66900);
  assert.equal(s.totals.due, 9800);
});

test("statement: empty month and invalid month", () => {
  const s = buildMonthlyStatement({ company, month: "2026-08", bookings });
  assert.equal(s.bookingCount, 0);
  assert.equal(s.totals.due, 0);
  assert.match(renderStatementHtml(s).html, /No confirmed bookings/);
  assert.throws(() => buildMonthlyStatement({ company, month: "Oct", bookings }), /Invalid statement month/);
});

test("CSV: one row per booking, numbers fixed to 2dp, formulas defused", () => {
  const evil = { ...venueA, id: "v-x", name: "=HYPERLINK(\"x\")" };
  const s = buildMonthlyStatement({ company, month: "2026-10", bookings: [...bookings, booking("b7", evil, "2026-10-02", intra(100))] });
  const lines = statementCsv(s).trimEnd().split("\r\n");
  assert.equal(lines.length, 1 + 4);
  assert.match(lines[0], /^statement,event_date,vendor/);
  assert.ok(lines.some((l) => l.includes("TLE/26-27/0042") && l.includes("59000.00")));
  assert.ok(lines.some((l) => l.includes(`"'=HYPERLINK(""x"")"`)), "formula cell is quoted and prefixed");
});

test("HTML: escaped, deterministic, says it is not a tax invoice", () => {
  const s = buildMonthlyStatement({ company: { ...company, legal_name: "<script>x</script> Ltd" }, month: "2026-10", bookings });
  const a = renderStatementHtml(s);
  const b = renderStatementHtml(s);
  assert.equal(a.sha256, b.sha256);
  assert.ok(!a.html.includes("<script>x"));
  assert.match(a.html, /&lt;script&gt;/);
  assert.match(a.html, /not a tax invoice/);
  assert.match(a.html, /ST-202610-1A2B3C4D/);
});
