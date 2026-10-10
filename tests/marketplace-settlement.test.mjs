import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateGst } from "../lib/gst-engine.ts";
import { computeSettlement, planSettlement, reconcileOrder, returnPeriod, SettlementError, tcsRateBps, transferStatus } from "../lib/marketplace/settlement.ts";

// Synthetic, checksum-valid GSTINs from the seed: Karnataka (29) and Tamil Nadu (33) suppliers.
const NIMBUS_KA = "29AABCN4821K1ZA";
const GIFTWISE_KA = "29AAGCG4512K1ZG";
const THREADLINE_TN = "33AAKCT6620P1ZV";
const PLATFORM_KA = "29AAJCV2268L1ZN";

const invoiceFor = (supplier, taxable, rate = 18) =>
  calculateGst({ total_amount: taxable, company_gstin: NIMBUS_KA, venue_gstin: supplier, tax: { kind: "HSN", code: "2106", description: "Gifting", rate_percent: rate } });

test("tcs: 1% until 9 July 2024, 0.5% from 10 July 2024", () => {
  assert.equal(tcsRateBps("2018-09-30"), 0);
  assert.equal(tcsRateBps("2018-10-01"), 100);
  assert.equal(tcsRateBps("2024-07-09"), 100);
  assert.equal(tcsRateBps("2024-07-10"), 50);
  assert.equal(tcsRateBps("2026-10-11"), 50);
});

test("settlement: intra-state order — commission + 18% GST on it + 0.25% CGST/SGST TCS", () => {
  const invoice = invoiceFor(GIFTWISE_KA, 36_000); // ₹36,000 + 18% = ₹42,480
  const s = computeSettlement({ invoice, commissionRate: 0.1, platformGstin: PLATFORM_KA, date: "2026-10-11" });
  assert.equal(s.gross, 42_480);
  assert.equal(s.commission, 3_600);
  assert.equal(s.commissionGst, 648); // 9% + 9%: platform and partner both in KA
  assert.equal(s.commissionInvoice.gst_type, "CGST_SGST");
  assert.equal(s.commissionInvoice.recipient.gstin, GIFTWISE_KA);
  assert.deepEqual(s.tcs, { rateBps: 50, cgst: 90, sgst: 90, igst: 0, total: 180 });
  assert.equal(s.net, 42_480 - 3_600 - 648 - 180);
});

test("settlement: inter-state supplier — IGST on commission, IGST TCS", () => {
  const invoice = invoiceFor(THREADLINE_TN, 6_500, 5); // tees at 5%: ₹6,825
  const s = computeSettlement({ invoice, commissionRate: 0.08, platformGstin: PLATFORM_KA, date: "2026-10-11" });
  assert.equal(s.gross, 6_825);
  assert.equal(s.commission, 520);
  assert.equal(s.commissionGst, 93.6);
  assert.equal(s.commissionInvoice.gst_type, "IGST");
  assert.deepEqual(s.tcs, { rateBps: 50, cgst: 0, sgst: 0, igst: 32.5, total: 32.5 });
  assert.equal(s.net, 6_178.9);
});

test("settlement: paise rounding is half-up per head and the parts always sum to the gross", () => {
  const invoice = invoiceFor(GIFTWISE_KA, 1_234.57);
  const s = computeSettlement({ invoice, commissionRate: 0.0725, platformGstin: PLATFORM_KA, date: "2024-07-09" });
  assert.equal(s.tcs.rateBps, 100);
  assert.equal(s.commission, 89.51); // 89.506…
  assert.equal(s.tcs.cgst, 6.17); // 6.1728…
  const parts = Math.round((s.net + s.commission + s.commissionGst + s.tcs.total) * 100);
  assert.equal(parts, Math.round(s.gross * 100));
});

test("settlement: zero commission, the 50% cap, and out-of-range rates", () => {
  const s = computeSettlement({ invoice: invoiceFor(GIFTWISE_KA, 1_000), commissionRate: 0, platformGstin: PLATFORM_KA, date: "2026-10-11" });
  assert.equal(s.commission, 0);
  assert.equal(s.commissionGst, 0);
  assert.equal(s.net, 1_180 - 5);
  assert.throws(() => computeSettlement({ invoice: invoiceFor(GIFTWISE_KA, 1_000), commissionRate: 0.6, platformGstin: PLATFORM_KA, date: "2026-10-11" }), SettlementError);
  // Even at the 50% cap on a 0% GST item the partner keeps something.
  assert.equal(computeSettlement({ invoice: invoiceFor(GIFTWISE_KA, 1_000, 0), commissionRate: 0.5, platformGstin: PLATFORM_KA, date: "2026-10-11" }).net, 1_000 - 500 - 90 - 5);
});

test("return period is the IST month", () => {
  assert.equal(returnPeriod(new Date("2026-10-31T18:29:59Z")), "2026-10");
  assert.equal(returnPeriod(new Date("2026-10-31T18:30:00Z")), "2026-11");
});

test("plan: payment follows the supplier — capture on confirm, hold until delivery, release", () => {
  const plan = (orderStatus, payment, payout, linkedAccount = true) => planSettlement({ orderStatus, payment, payout, linkedAccount });
  assert.deepEqual(plan("PLACED", "authorized", null), []);
  assert.deepEqual(plan("CONFIRMED", "authorized", null), ["capture", "transfer"]);
  assert.deepEqual(plan("CONFIRMED", "authorized", null, false), ["capture"]);
  assert.deepEqual(plan("SHIPPED", "captured", "on_hold"), []);
  assert.deepEqual(plan("DELIVERED", "captured", "on_hold"), ["release"]);
  // Paid only after delivery: everything at once.
  assert.deepEqual(plan("DELIVERED", "authorized", null), ["capture", "transfer", "release"]);
  assert.deepEqual(plan("DELIVERED", "captured", "failed"), ["transfer", "release"]);
  assert.deepEqual(plan("SETTLED", "captured", "released"), []);
  assert.deepEqual(plan("CONFIRMED", null, null), []);
  assert.deepEqual(plan("CANCELLED", "authorized", null), ["void"]);
  assert.deepEqual(plan("CANCELLED", "created", null), ["void"]);
  assert.deepEqual(plan("CANCELLED", "captured", "on_hold"), ["refund"]);
  assert.deepEqual(plan("CANCELLED", "refunded", "reversed"), []);
});

test("reconcile: a clean order ties out at each stage", () => {
  const order = { status: "DELIVERED", taxable: 36_000, invoiceTotal: 42_480 };
  const allocation = { amount: 36_000, status: "consumed" };
  assert.deepEqual(reconcileOrder({ order, allocation, payment: { amount: 42_480, status: "captured" }, payout: { gross: 42_480, status: "released" } }), { stage: "payout_released", issues: [] });
  assert.deepEqual(reconcileOrder({ order: { ...order, status: "PLACED" }, allocation: { ...allocation, status: "committed" }, payment: null, payout: null }), { stage: "unpaid", issues: [] });
  assert.deepEqual(reconcileOrder({ order: { ...order, status: "CANCELLED" }, allocation: { ...allocation, status: "released" }, payment: { amount: 42_480, status: "voided" }, payout: null }), { stage: "closed", issues: [] });
});

test("reconcile: flags what doesn't tie out", () => {
  const r = reconcileOrder({
    order: { status: "DELIVERED", taxable: 36_000, invoiceTotal: 42_480 },
    allocation: { amount: 35_000, status: "committed" },
    payment: { amount: 42_000, status: "captured" },
    payout: { gross: 42_480, status: "on_hold" },
  });
  assert.equal(r.stage, "payout_held");
  assert.equal(r.issues.length, 5);
  assert.match(r.issues[0], /PO allocation ₹35,000.00 doesn't match the order's ₹36,000.00/);
  assert.match(r.issues[1], /should be consumed/);
  assert.match(r.issues[2], /Payment ₹42,000.00 doesn't match the invoice total ₹42,480.00/);
  assert.match(r.issues[3], /computed on ₹42,480.00/);
  assert.match(r.issues[4], /still on hold/);

  const cancelled = reconcileOrder({ order: { status: "CANCELLED", taxable: 100, invoiceTotal: 118 }, allocation: null, payment: { amount: 118, status: "captured" }, payout: { gross: 118, status: "on_hold" } });
  assert.deepEqual(cancelled.issues, ["Cancelled, but the payment hasn't been refunded.", "Cancelled, but the payout hasn't been reversed."]);
  assert.deepEqual(reconcileOrder({ order: { status: "DELIVERED", taxable: 1, invoiceTotal: 1.18 }, allocation: null, payment: null, payout: null }).issues, ["Delivered without a captured payment."]);
});

test("transfer webhooks: held transfers stay put; released, settled, failed and reversed map through", () => {
  assert.equal(transferStatus("transfer.processed", { on_hold: true, settlement_status: "on_hold" }), null);
  assert.equal(transferStatus("transfer.processed", { on_hold: false, settlement_status: "pending" }), "released");
  assert.equal(transferStatus("transfer.processed", { on_hold: false, settlement_status: "settled" }), "settled");
  assert.equal(transferStatus("transfer.failed", {}), "failed");
  assert.equal(transferStatus("transfer.reversed", {}), "reversed");
  assert.equal(transferStatus("transfer.created", {}), null);
});
