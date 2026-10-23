/**
 * The event workspace's money summary: invoice line items from the booking's
 * own tax invoice (no invented splits), plus deposit and receipt readiness.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/event-plan.test.mjs).
 */

export interface InvoiceLine {
  label: string;
  amount: number;
  kind: "list" | "discount" | "subtotal" | "tax" | "total";
  /** e.g. "60 guests × ₹1,800". */
  detail?: string;
}

interface TaxHeadLike {
  rate_percent: number;
  amount: number;
}

export interface BookingMoney {
  party_size: number;
  /** The negotiated per-head, pre-GST. */
  budget_per_head_inr: number;
  /** The per-head before the company's rate card (null = no card applied). */
  list_budget_per_head_inr: number | null;
  invoice: {
    taxable_value: number;
    gst_type: string;
    tax_breakup: { cgst: TaxHeadLike; sgst: TaxHeadLike; igst: TaxHeadLike };
    invoice_total: number;
  };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Price → (rate-card discount) → taxable value → GST heads → invoice total.
 * GST shows CGST + SGST for intra-state supplies and IGST otherwise, as on the
 * invoice. The lines always sum to the invoice total.
 */
export function invoiceLines(b: BookingMoney): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  const taxable = b.invoice.taxable_value;
  const list = b.list_budget_per_head_inr != null ? round2(b.list_budget_per_head_inr * b.party_size) : null;
  if (list != null && list > taxable) {
    lines.push({ label: "Venue price", amount: list, kind: "list", detail: `${b.party_size} guests × ${inr(b.list_budget_per_head_inr!)}` });
    lines.push({ label: "Corporate rate-card discount", amount: round2(taxable - list), kind: "discount" });
    lines.push({ label: "Taxable value", amount: taxable, kind: "subtotal", detail: `${b.party_size} guests × ${inr(b.budget_per_head_inr)}` });
  } else {
    lines.push({ label: "Venue price (taxable)", amount: taxable, kind: "subtotal", detail: `${b.party_size} guests × ${inr(b.budget_per_head_inr)}` });
  }
  const { cgst, sgst, igst } = b.invoice.tax_breakup;
  if (igst.amount > 0 || b.invoice.gst_type === "IGST") {
    lines.push({ label: `IGST ${igst.rate_percent}%`, amount: igst.amount, kind: "tax" });
  } else {
    lines.push({ label: `CGST ${cgst.rate_percent}%`, amount: cgst.amount, kind: "tax" });
    lines.push({ label: `SGST ${sgst.rate_percent}%`, amount: sgst.amount, kind: "tax" });
  }
  lines.push({ label: "Invoice total", amount: b.invoice.invoice_total, kind: "total" });
  return lines;
}

export type Readiness = { tone: "done" | "pending" | "waiting" | "none" | "problem"; label: string; hint: string };

/** The deposit's state, from the latest payment row (if any). */
export function depositReadiness(bookingStatus: string, payment: { status: string; amount_inr: number } | null, paymentsEnabled: boolean): Readiness {
  if (payment) {
    const amount = inr(Number(payment.amount_inr));
    switch (payment.status) {
      case "captured":
        return { tone: "done", label: `Deposit paid · ${amount}`, hint: "Captured when the venue confirmed." };
      case "authorized":
        return { tone: "pending", label: `Deposit authorised · ${amount}`, hint: "Held on the card; captured when the venue confirms." };
      case "voided":
      case "refunded":
        return { tone: "none", label: `Deposit released · ${amount}`, hint: "The hold was released; nothing was charged." };
      case "failed":
        return { tone: "problem", label: "Deposit failed", hint: "The payment didn't go through. Try again from the bookings table." };
      default:
        return { tone: "waiting", label: `Deposit ${payment.status}`, hint: "Waiting on the payment provider." };
    }
  }
  if (bookingStatus === "CANCELLED") return { tone: "none", label: "No deposit", hint: "Cancelled before a deposit was taken." };
  if (!paymentsEnabled) return { tone: "none", label: "No online deposit", hint: "Online deposits aren't enabled; settle with the venue directly." };
  if (bookingStatus === "PENDING") return { tone: "waiting", label: "Deposit due", hint: "Pay it from the bookings table; it's held until the venue confirms." };
  if (bookingStatus === "PENDING_APPROVAL") return { tone: "waiting", label: "Deposit after sign-off", hint: "Deposits are taken once the request is signed off." };
  return { tone: "none", label: "No deposit recorded", hint: "This booking was confirmed without an online deposit." };
}

/** The final invoice and receipt, from the booking status and its expense export (if any). */
export function receiptReadiness(bookingStatus: string, exportStatus: string | null): Readiness {
  if (exportStatus === "failed" || exportStatus === "dead_lettered") return { tone: "problem", label: "Receipt export failed", hint: "The receipt couldn't reach your expense system. An Approver can retry the sync." };
  if (exportStatus) return { tone: "done", label: "Receipt ready", hint: "The structured receipt was exported to finance." };
  if (bookingStatus === "CANCELLED") return { tone: "none", label: "No invoice", hint: "Cancelled, so no invoice was issued." };
  if (["CONFIRMED", "COMPLETED", "SETTLED"].includes(bookingStatus)) return { tone: "pending", label: "Invoice issued · receipt pending", hint: "Confirmed; the receipt hasn't been exported to finance yet." };
  return { tone: "waiting", label: "Invoice on confirmation", hint: "The tax invoice and receipt are issued when the venue confirms." };
}
