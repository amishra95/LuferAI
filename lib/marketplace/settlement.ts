/**
 * Marketplace settlement for catalogue orders (migration 0023): what the
 * partner is paid through Razorpay Route, the Section 52 TCS the platform
 * collects, the next settlement step for an order, and its PO reconciliation.
 *
 * The partner is the supplier of record (their GSTIN is on the buyer's
 * invoice); the platform is the e-commerce operator collecting the payment.
 * From the invoice total the platform keeps:
 *   - its commission on the taxable value, plus GST on that commission (the
 *     platform's own supply to the partner, invoiced under PLATFORM_GSTIN);
 *   - TCS under Section 52 of the CGST Act on the net taxable value, deposited
 *     with the government and credited to the partner (GSTR-8 → their GSTR-2X).
 * The rest is the Route transfer, held until the order is delivered.
 *
 * Arithmetic is in integer paise, rounded half-up per tax head like the GST
 * engine. Pure: tests/marketplace-settlement.test.mjs imports it directly.
 *
 * NOT TAX ADVICE: the TCS schedule, the commission SAC and treating TCS as due
 * on the month of collection should be confirmed with the platform's tax advisor.
 */
import { calculateGst, type TaxClassification, type TaxInvoicePayload } from "../gst-engine.ts";
import { orderAllocationStatus } from "../catalog/orders.ts";

// ----------------------------------------------------------------------------
// Rates
// ----------------------------------------------------------------------------

/**
 * Section 52 TCS rate in basis points of the net taxable value, by the date
 * the supply is made through the platform: 1% from the start of TCS
 * (1 Oct 2018), 0.5% from 10 July 2024 (Notification 15/2024-Central Tax).
 * Intra-state: half CGST, half SGST. Inter-state: all IGST.
 */
export const TCS_SCHEDULE: readonly { from: string; bps: number }[] = [
  { from: "2018-10-01", bps: 100 },
  { from: "2024-07-10", bps: 50 },
];

export function tcsRateBps(date: string): number {
  let bps = 0;
  for (const r of TCS_SCHEDULE) if (date >= r.from) bps = r.bps;
  return bps;
}

/** The platform's commission invoice to the partner. */
export const COMMISSION_TAX: TaxClassification = {
  kind: "SAC",
  code: "998599",
  description: "Marketplace facilitation services (platform commission)",
  rate_percent: 18,
};

// ----------------------------------------------------------------------------
// The settlement for one order
// ----------------------------------------------------------------------------

const toPaise = (inr: number) => Math.round(Number((inr * 100).toPrecision(15)));
const toInr = (paise: number) => paise / 100;
/** paise × bps / 10 000, half-up, in BigInt (large orders exceed 2^53 when scaled). */
const bpsOf = (paise: number, bps: number) => Number((BigInt(paise) * BigInt(bps) + BigInt(5_000)) / BigInt(10_000));

export type InvoiceForSettlement = Pick<TaxInvoicePayload, "taxable_value" | "invoice_total" | "supply_type" | "supplier" | "place_of_supply">;

export interface Settlement {
  /** What the buyer paid: the invoice total including GST. */
  gross: number;
  taxable: number;
  commissionRate: number;
  commission: number;
  commissionGst: number;
  /** The platform's invoice to the partner for its commission. */
  commissionInvoice: TaxInvoicePayload;
  tcs: { rateBps: number; cgst: number; sgst: number; igst: number; total: number };
  /** The Route transfer to the partner. */
  net: number;
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

/**
 * Splits an order's invoice between the partner, the platform and the TCS
 * deposit. `date` is the day the payment is captured (YYYY-MM-DD, IST).
 */
export function computeSettlement(input: { invoice: InvoiceForSettlement; commissionRate: number; platformGstin: string; date: string }): Settlement {
  const { invoice, commissionRate, date } = input;
  if (!(commissionRate >= 0 && commissionRate <= 0.5)) throw new SettlementError("Commission must be between 0% and 50%.");
  const grossPaise = toPaise(invoice.invoice_total);
  const taxablePaise = toPaise(invoice.taxable_value);

  const commissionPaise = bpsOf(taxablePaise, Math.round(commissionRate * 10_000));
  const commissionInvoice = calculateGst({
    total_amount: toInr(commissionPaise),
    // The partner is the recipient of the platform's service.
    company_gstin: invoice.supplier.gstin,
    venue_gstin: input.platformGstin,
    tax: COMMISSION_TAX,
    invoice_date: date,
  });
  const commissionGstPaise = toPaise(commissionInvoice.total_tax);

  const rateBps = tcsRateBps(date);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (invoice.supply_type === "INTRA_STATE") {
    cgst = bpsOf(taxablePaise, rateBps / 2);
    sgst = cgst;
  } else {
    igst = bpsOf(taxablePaise, rateBps);
  }
  const tcsPaise = cgst + sgst + igst;

  const netPaise = grossPaise - commissionPaise - commissionGstPaise - tcsPaise;
  if (netPaise < 0) throw new SettlementError("Commission, its GST and TCS exceed what the buyer paid.");
  return {
    gross: toInr(grossPaise),
    taxable: toInr(taxablePaise),
    commissionRate,
    commission: toInr(commissionPaise),
    commissionGst: toInr(commissionGstPaise),
    commissionInvoice,
    tcs: { rateBps, cgst: toInr(cgst), sgst: toInr(sgst), igst: toInr(igst), total: toInr(tcsPaise) },
    net: toInr(netPaise),
  };
}

/** The GSTR-8 return period (YYYY-MM) for a moment, in IST. */
export function returnPeriod(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 7);
}

// ----------------------------------------------------------------------------
// What to do next
// ----------------------------------------------------------------------------

export type PaymentState = "created" | "authorized" | "captured" | "voided" | "failed" | "refunded";
export type PayoutState = "pending" | "on_hold" | "released" | "settled" | "reversed" | "failed";
export type SettlementStep = "capture" | "transfer" | "release" | "void" | "refund";

/** Order statuses at which the supplier has committed, so the payment is taken. */
const COMMITTED = new Set(["CONFIRMED", "SHIPPED", "DELIVERED", "SETTLED"]);
const DELIVERED = new Set(["DELIVERED", "SETTLED"]);

/**
 * The settlement steps an order needs now, in order. Idempotent: run it after
 * every order change and every payment/transfer webhook, and apply the steps.
 *
 *   committed + authorised            → capture
 *   captured, no payout (or failed)   → transfer (on hold), if the partner has a linked account
 *   delivered + payout on hold        → release
 *   cancelled + authorised/created    → void
 *   cancelled + captured              → refund (Razorpay reverses the transfer with it)
 */
export function planSettlement(s: { orderStatus: string; payment: PaymentState | null; payout: PayoutState | null; linkedAccount: boolean }): SettlementStep[] {
  if (s.orderStatus === "CANCELLED") {
    if (s.payment === "authorized" || s.payment === "created") return ["void"];
    if (s.payment === "captured") return ["refund"];
    return [];
  }
  if (!COMMITTED.has(s.orderStatus)) return [];
  const steps: SettlementStep[] = [];
  let payment = s.payment;
  let payout = s.payout;
  if (payment === "authorized") {
    steps.push("capture");
    payment = "captured";
  }
  if (payment !== "captured") return steps;
  if ((payout === null || payout === "failed") && s.linkedAccount) {
    steps.push("transfer");
    payout = "on_hold";
  }
  if (payout === "on_hold" && DELIVERED.has(s.orderStatus)) steps.push("release");
  return steps;
}

// ----------------------------------------------------------------------------
// Route transfer webhooks
// ----------------------------------------------------------------------------

export type TransferOutcome = "released" | "settled" | "failed" | "reversed" | null;

/** transfer.* webhook → our payout status. A processed transfer is released unless held; settled once paid out. */
export function transferStatus(event: string, t: { on_hold?: boolean; settlement_status?: string | null }): TransferOutcome {
  if (event === "transfer.failed") return "failed";
  if (event === "transfer.reversed") return "reversed";
  if (event === "transfer.processed" || event === "transfer.settled") {
    if (t.settlement_status === "settled") return "settled";
    return t.on_hold ? null : "released";
  }
  return null;
}

// ----------------------------------------------------------------------------
// PO reconciliation
// ----------------------------------------------------------------------------

export type ReconciliationStage = "unpaid" | "authorized" | "paid" | "payout_held" | "payout_released" | "settled" | "refunded" | "closed";

export const STAGE_LABEL: Record<ReconciliationStage, string> = {
  unpaid: "Awaiting payment",
  authorized: "Payment authorised",
  paid: "Paid · payout pending",
  payout_held: "Paid · payout on hold",
  payout_released: "Payout released",
  settled: "Settled to supplier",
  refunded: "Refunded",
  closed: "Closed unpaid",
};

export interface ReconcileInput {
  order: { status: string; taxable: number; invoiceTotal: number };
  allocation: { amount: number; status: string } | null;
  payment: { amount: number; status: PaymentState } | null;
  payout: { gross: number; status: PayoutState } | null;
}

/**
 * Where an order is between the buyer's PO, their payment and the partner's
 * payout, and anything that doesn't tie out. The PO draws the pre-GST value;
 * the payment and payout carry the invoice total.
 */
export function reconcileOrder({ order, allocation, payment, payout }: ReconcileInput): { stage: ReconciliationStage; issues: string[] } {
  const issues: string[] = [];
  const eq = (a: number, b: number) => toPaise(a) === toPaise(b);
  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (allocation) {
    if (!eq(allocation.amount, order.taxable)) issues.push(`PO allocation ${inr(allocation.amount)} doesn't match the order's ${inr(order.taxable)} pre-GST.`);
    const expected = orderAllocationStatus(order.status);
    if (allocation.status !== expected) issues.push(`PO allocation is ${allocation.status}; a ${order.status.toLowerCase().replace("_", " ")} order should be ${expected}.`);
  }
  if (payment && (payment.status === "captured" || payment.status === "refunded") && !eq(payment.amount, order.invoiceTotal)) {
    issues.push(`Payment ${inr(payment.amount)} doesn't match the invoice total ${inr(order.invoiceTotal)}.`);
  }
  if (payout && payment && !eq(payout.gross, payment.amount)) issues.push(`Payout was computed on ${inr(payout.gross)}, but ${inr(payment.amount)} was paid.`);
  if (payout?.status === "failed") issues.push("The Route transfer failed: retry it from the order.");
  if (payout?.status === "on_hold" && DELIVERED.has(order.status)) issues.push("Delivered, but the payout is still on hold.");
  if (order.status === "CANCELLED" && payment?.status === "captured") issues.push("Cancelled, but the payment hasn't been refunded.");
  if (order.status === "CANCELLED" && payout && payout.status !== "reversed" && payout.status !== "failed") issues.push("Cancelled, but the payout hasn't been reversed.");
  if (DELIVERED.has(order.status) && payment?.status !== "captured") issues.push("Delivered without a captured payment.");

  let stage: ReconciliationStage;
  if (payment?.status === "refunded") stage = "refunded";
  else if (payout?.status === "settled") stage = "settled";
  else if (payout?.status === "released") stage = "payout_released";
  else if (payout?.status === "on_hold") stage = "payout_held";
  else if (payment?.status === "captured") stage = "paid";
  else if (payment?.status === "authorized") stage = "authorized";
  else stage = order.status === "CANCELLED" ? "closed" : "unpaid";
  return { stage, issues };
}
