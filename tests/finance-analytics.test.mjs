// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeSpend,
  budgetOutlook,
  forecastSpend,
  linearTrend,
  monthlySpend,
  monthRange,
  resolvePeriod,
  savingsOf,
} from "../lib/analytics/finance.ts";

const TODAY = "2026-10-07";

const b = (event_date, total, extra = {}) => ({
  event_date,
  status: "CONFIRMED",
  total_amount_inr: total,
  gst_inr: total * 0.18,
  invoice_total_inr: total * 1.18,
  party_size: 10,
  list_per_head_inr: null,
  venue: "Olive Bar",
  company: "Nimbus",
  department: "Engineering",
  cost_center: "ENG-BLR",
  ...extra,
});

test("periods follow the Indian financial year and rolling windows", () => {
  assert.deepEqual(resolvePeriod("fytd", TODAY), { from: "2026-04-01", to: TODAY, label: "FY26–27 to date" });
  assert.deepEqual(resolvePeriod("last_fy", TODAY), { from: "2025-04-01", to: "2026-03-31", label: "FY25–26" });
  assert.equal(resolvePeriod("last_30_days", TODAY).from, "2026-09-08");
  assert.equal(resolvePeriod("this_month", TODAY).from, "2026-10-01");
  assert.deepEqual(resolvePeriod("next_90_days", TODAY), { from: "2026-10-08", to: "2027-01-05", label: "the next 90 days (committed)" });
  assert.equal(resolvePeriod("last_fy", "2026-03-31").label, "FY24–25", "31 Mar is still the old FY");
});

test("spend counts committed bookings only, with GST, savings and per-head", () => {
  const rows = [
    b("2026-05-10", 100000, { list_per_head_inr: 12000 }), // 120k list → 20k saved
    b("2026-06-10", 50000, { venue: "Toit", department: null }),
    b("2026-06-12", 999999, { status: "CANCELLED" }),
    b("2025-12-01", 70000), // previous FY
  ];
  const r = analyzeSpend(rows, { period: "fytd", groupBy: "venue" }, TODAY);
  assert.equal(r.totals.bookings, 2);
  assert.equal(r.totals.spend, 150000);
  assert.equal(r.totals.gst, 27000);
  assert.equal(r.totals.invoiceTotal, 177000);
  assert.equal(r.totals.savings, 20000);
  assert.equal(r.totals.avgPerHead, 7500);
  assert.deepEqual(r.rows.map((x) => [x.key, x.spend, x.share]), [["Olive Bar", 100000, 66.7], ["Toit", 50000, 33.3]]);
  assert.equal(savingsOf(b("2026-05-10", 130000, { list_per_head_inr: 12000 })), 0, "never negative");
});

test("grouping by status shows cancellations; by month sorts chronologically", () => {
  const rows = [b("2026-06-10", 50000), b("2026-05-10", 10000), b("2026-06-12", 30000, { status: "CANCELLED" })];
  const byStatus = analyzeSpend(rows, { period: "fytd", groupBy: "status" }, TODAY);
  assert.deepEqual(byStatus.rows.map((x) => [x.key, x.bookings, x.spend]), [["CONFIRMED", 2, 60000], ["CANCELLED", 1, 0]]);
  const byMonth = analyzeSpend(rows, { period: "fytd", groupBy: "month" }, TODAY);
  assert.deepEqual(byMonth.rows.map((x) => x.key), ["2026-05", "2026-06"]);
  const byDept = analyzeSpend([b("2026-06-10", 1, { department: null })], { period: "fytd", groupBy: "department" }, TODAY);
  assert.equal(byDept.rows[0].key, "No department");
});

test("long tails fold into Other", () => {
  const rows = Array.from({ length: 15 }, (_, i) => b("2026-06-10", 1000 * (i + 1), { venue: `V${i}` }));
  const r = analyzeSpend(rows, { period: "fytd", groupBy: "venue" }, TODAY, 5);
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows.at(-1).key, "Other");
  assert.equal(r.otherGroups, 11);
  assert.equal(r.rows.reduce((s, x) => s + x.spend, 0), r.totals.spend);
});

test("month ranges and monthly totals", () => {
  assert.deepEqual(monthRange("2026-11-15", "2027-02-01"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthlySpend([b("2026-05-02", 10), b("2026-05-20", 5), b("2026-07-01", 1, { status: "CANCELLED" })], ["2026-05", "2026-06", "2026-07"]), [15, 0, 0]);
});

test("linear trend recovers a clean line", () => {
  const t = linearTrend([100, 200, 300, 400]);
  assert.equal(t.slope, 100);
  assert.equal(t.intercept, 100);
  assert.equal(t.residualSd, 0);
  assert.deepEqual(linearTrend([]), { slope: 0, intercept: 0, residualSd: 0 });
});

test("forecast extends the trend but never below what's already booked", () => {
  const f = forecastSpend([100, 200, 300, 400], [
    { month: "2026-11", committed: 0 },
    { month: "2026-12", committed: 900 },
  ]);
  assert.deepEqual(f.map((m) => [m.trend, m.projected]), [[500, 500], [600, 900]]);
  assert.ok(f.every((m) => m.low <= m.projected && m.projected <= Math.max(m.high, m.committed)));
});

test("thin history falls back to the average run-rate", () => {
  const f = forecastSpend([0, 0, 300, 0, 600], [{ month: "2026-11", committed: 0 }]);
  assert.equal(f[0].trend, 180);
  assert.equal(forecastSpend([], [{ month: "2026-11", committed: 50 }])[0].projected, 50);
});

test("budget outlook finds the month a budget runs out", () => {
  const forecast = forecastSpend([100, 100, 100, 100], [
    { month: "2026-10", committed: 0 },
    { month: "2026-11", committed: 0 },
    { month: "2026-12", committed: 0 },
  ]);
  // 250 spent, then +100/month: 350 (Oct), 450 (Nov), 550 (Dec).
  const tight = budgetOutlook(440, 250, forecast);
  assert.equal(tight.projectedTotal, 550);
  assert.equal(tight.exhaustionMonth, "2026-11");
  assert.equal(tight.status, "at_risk");
  assert.equal(tight.remaining, 190);
  assert.equal(tight.projectedUtilisationPct, 125);
  assert.equal(budgetOutlook(450, 250, forecast).exhaustionMonth, "2026-12", "reaching the budget exactly isn't exceeding it");

  const roomy = budgetOutlook(1000, 250, forecast);
  assert.equal(roomy.status, "on_track");
  assert.equal(roomy.exhaustionMonth, null);

  const blown = budgetOutlook(200, 250, forecast);
  assert.equal(blown.status, "over_budget");
  assert.equal(blown.exhaustionMonth, null, "already over: no future month to report");
});
