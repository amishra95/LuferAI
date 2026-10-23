/**
 * Reconciles a venue's invoice, as read by OCR (lib/ai/invoice-schema.ts),
 * with what the booking should have been invoiced (its GST engine payload).
 * The result is the invoice check: verified when nothing blocks, else the
 * discrepancies. It never decides input tax credit: that stays finance's call
 * (bookings.itc_decision, lib/finance/itc.ts), since credit on food and
 * catering is often blocked by law (Sec. 17(5)) however clean the invoice.
 * Pure: tests/ai/ocr.test.mjs imports it directly.
 *
 * Blocking findings are the ones that would stop a credit claim, or that mean
 * the invoice isn't for what was booked:
 *   - the supplier GSTIN is missing, invalid, or not the venue's
 *   - the recipient GSTIN is missing or not the one the booking was billed to
 *     (credit is claimed on the GSTIN named on the invoice, Rule 46)
 *   - no invoice number, or an invoice dated in the future
 *   - the wrong tax type (CGST + SGST for an inter-state supply, or IGST within a state)
 *   - the taxable value, a tax head or the total differing from the booking by
 *     more than the round-off tolerance, or an invoice whose own figures don't add up
 * Warnings are shown but don't fail the check: line items that don't sum to
 * the subtotal, a SAC code other than the booking's, an unreadable date.
 */
import { validateGstin, type TaxInvoicePayload } from "../gst-engine.ts";
import type { InvoiceExtraction } from "../ai/invoice-schema.ts";

/** Per figure: invoices round to the rupee, and OCR can't do better than the print. */
export const RECONCILE_TOLERANCE_INR = 1;

export type FindingCode =
  | "VENDOR_GSTIN_MISSING"
  | "VENDOR_GSTIN_INVALID"
  | "VENDOR_GSTIN_MISMATCH"
  | "BUYER_GSTIN_MISSING"
  | "BUYER_GSTIN_MISMATCH"
  | "INVOICE_NUMBER_MISSING"
  | "INVOICE_DATE_MISSING"
  | "INVOICE_DATE_FUTURE"
  | "TAX_TYPE_MISMATCH"
  | "SUBTOTAL_MISMATCH"
  | "CGST_MISMATCH"
  | "SGST_MISMATCH"
  | "IGST_MISMATCH"
  | "TOTAL_MISMATCH"
  | "ARITHMETIC_ERROR"
  | "AMOUNT_UNREADABLE"
  | "LINE_ITEMS_MISMATCH"
  | "SAC_MISMATCH";

export interface Finding {
  code: FindingCode;
  severity: "block" | "warn";
  message: string;
  expected?: string | number | null;
  found?: string | number | null;
}

export interface ReconcileInput {
  invoice: InvoiceExtraction;
  /** The booking's GST engine invoice: what the venue should have billed. */
  expected: Pick<TaxInvoicePayload, "gst_type" | "taxable_value" | "tax_breakup" | "total_tax" | "invoice_total" | "sac">;
  venueGstin: string;
  /** The GSTIN the booking is billed to (bookings.billing_gstin, else the company's). */
  billedGstin: string;
  /** YYYY-MM-DD, India time. */
  today: string;
}

export interface Reconciliation {
  /** verified: the invoice matches the booking; discrepancies: at least one blocking finding. */
  status: "verified" | "discrepancies";
  findings: Finding[];
  /** One line for the approver's ITC note (max 500 characters, as bookings.itc_note). */
  note: string;
}

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const differs = (a: number, b: number) => Math.abs(a - b) > RECONCILE_TOLERANCE_INR;

export function reconcileInvoice({ invoice: inv, expected, venueGstin, billedGstin, today }: ReconcileInput): Reconciliation {
  const findings: Finding[] = [];
  const block = (code: FindingCode, message: string, expectedV?: Finding["expected"], found?: Finding["found"]) =>
    findings.push({ code, severity: "block", message, ...(expectedV !== undefined && { expected: expectedV }), ...(found !== undefined && { found }) });
  const warn = (code: FindingCode, message: string, expectedV?: Finding["expected"], found?: Finding["found"]) =>
    findings.push({ code, severity: "warn", message, ...(expectedV !== undefined && { expected: expectedV }), ...(found !== undefined && { found }) });

  // Parties
  if (!inv.vendor_gstin) block("VENDOR_GSTIN_MISSING", "The supplier's GSTIN isn't on the invoice (or couldn't be read).", venueGstin, null);
  else if (!validateGstin(inv.vendor_gstin).valid) block("VENDOR_GSTIN_INVALID", `The supplier GSTIN ${inv.vendor_gstin} isn't a valid GSTIN.`, venueGstin, inv.vendor_gstin);
  else if (inv.vendor_gstin !== venueGstin.toUpperCase()) block("VENDOR_GSTIN_MISMATCH", `Issued by ${inv.vendor_gstin}, not the venue's GSTIN.`, venueGstin, inv.vendor_gstin);

  if (!inv.buyer_gstin) block("BUYER_GSTIN_MISSING", "The recipient GSTIN isn't on the invoice (or couldn't be read): credit can't be claimed without it.", billedGstin, null);
  else if (inv.buyer_gstin !== billedGstin.toUpperCase()) block("BUYER_GSTIN_MISMATCH", `Billed to ${inv.buyer_gstin}, not ${billedGstin}.`, billedGstin, inv.buyer_gstin);

  // Document
  if (!inv.invoice_number) block("INVOICE_NUMBER_MISSING", "No invoice number.");
  if (!inv.invoice_date) warn("INVOICE_DATE_MISSING", "The invoice date couldn't be read.");
  else if (inv.invoice_date > today) block("INVOICE_DATE_FUTURE", `Dated ${inv.invoice_date}, in the future.`, today, inv.invoice_date);

  // Tax type: what was charged, not what's printed as zero.
  const interState = expected.gst_type === "IGST";
  const chargedIntra = (inv.cgst ?? 0) > 0 || (inv.sgst ?? 0) > 0;
  const chargedInter = (inv.igst ?? 0) > 0;
  if (interState && chargedIntra) block("TAX_TYPE_MISMATCH", "CGST + SGST was charged on an inter-state supply, which takes IGST.", "IGST", "CGST_SGST");
  if (!interState && chargedInter) block("TAX_TYPE_MISMATCH", "IGST was charged on a supply within the state, which takes CGST + SGST.", "CGST_SGST", "IGST");

  // Amounts against the booking
  const figure = (code: FindingCode, label: string, found: number | null, want: number) => {
    if (found === null) return block("AMOUNT_UNREADABLE", `The ${label} couldn't be read.`, want, null);
    if (differs(found, want)) block(code, `${label[0].toUpperCase()}${label.slice(1)} is ${INR.format(found)}; the booking is ${INR.format(want)}.`, want, found);
  };
  figure("SUBTOTAL_MISMATCH", "taxable value", inv.subtotal, expected.taxable_value);
  const tb = expected.tax_breakup;
  // A head that wasn't charged is read as 0, whether printed as 0 or left off.
  if (!findings.some((f) => f.code === "TAX_TYPE_MISMATCH")) {
    figure("CGST_MISMATCH", "CGST", inv.cgst ?? 0, tb.cgst.amount);
    figure("SGST_MISMATCH", "SGST", inv.sgst ?? 0, tb.sgst.amount);
    figure("IGST_MISMATCH", "IGST", inv.igst ?? 0, tb.igst.amount);
  }
  figure("TOTAL_MISMATCH", "invoice total", inv.total_amount, expected.invoice_total);

  // The invoice's own arithmetic
  if (inv.subtotal !== null && inv.total_amount !== null) {
    const sum = inv.subtotal + (inv.cgst ?? 0) + (inv.sgst ?? 0) + (inv.igst ?? 0);
    if (differs(sum, inv.total_amount)) block("ARITHMETIC_ERROR", `The invoice doesn't add up: taxable value plus GST is ${INR.format(sum)}, the total ${INR.format(inv.total_amount)}.`, sum, inv.total_amount);
  }
  const lines = inv.line_items.filter((l) => l.amount !== null);
  if (lines.length && inv.subtotal !== null) {
    const sum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    if (differs(sum, inv.subtotal)) warn("LINE_ITEMS_MISMATCH", `Line items add up to ${INR.format(sum)}, not the taxable value.`, inv.subtotal, sum);
  }
  const otherSac = inv.line_items.map((l) => l.hsn_sac).find((c) => c && c !== expected.sac.code);
  if (otherSac) warn("SAC_MISMATCH", `A line is coded ${otherSac}; the booking is SAC ${expected.sac.code}.`, expected.sac.code, otherSac);

  const blocking = findings.filter((f) => f.severity === "block");
  const status = blocking.length ? "discrepancies" : "verified";
  const ref = inv.invoice_number ? `Invoice ${inv.invoice_number}` : "Invoice";
  const note = status === "verified" ? `${ref} matched the booking (OCR check).` : `${ref}: ${blocking.map((f) => f.message).join(" ")}`;
  return { status, findings, note: note.slice(0, 500) };
}
