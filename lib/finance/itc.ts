/**
 * Input tax credit (ITC) status and compliance tags for a booking. Credit is
 * never assumed: GST on food, beverages and catering is often blocked under
 * Sec. 17(5) CGST Act, so a booking is only "eligible" once finance says so
 * (bookings.itc_decision, migration 20261101120000). Until then it is pending
 * review, or awaiting its tax invoice.
 *
 * Pure (no server imports), so tests/finance/itc.test.mjs can use it.
 */
import { validateGstin } from "../gst-engine.ts";

export const ITC_STATUSES = ["eligible", "blocked", "review", "awaiting_invoice", "not_eligible", "not_applicable"] as const;
export type ItcStatus = (typeof ITC_STATUSES)[number];
export type ItcDecision = "eligible" | "blocked";

export const ITC_LABEL: Record<ItcStatus, string> = {
  eligible: "ITC eligible",
  blocked: "ITC blocked",
  review: "Pending finance review",
  awaiting_invoice: "Awaiting tax invoice",
  not_eligible: "Not eligible",
  not_applicable: "No ITC (cancelled)",
};

/** A booking's tax invoice exists once the event is done (completed or settled). */
export const isInvoiced = (status: string) => status === "COMPLETED" || status === "SETTLED";

/** The PAN inside a GSTIN (characters 3–12): same PAN = same legal entity. */
const panOf = (gstin: string) => gstin.trim().toUpperCase().slice(2, 12);

export interface ItcInput {
  status: string;
  itc_decision: ItcDecision | string | null;
  /** The company's registered GSTIN, and the one the booking is billed to (null = registered). */
  company_gstin: string;
  billed_gstin: string | null;
  venue_gstin: string;
}

/**
 * Where a booking stands for ITC. Not eligible outright when it isn't billed
 * to the buyer's own legal entity or the supplier's GSTIN is invalid (no valid
 * tax invoice can follow); otherwise finance's decision, else awaiting the
 * invoice, else pending review.
 */
export function itcStatusOf(b: ItcInput): ItcStatus {
  if (b.status === "CANCELLED") return "not_applicable";
  if (panOf(b.billed_gstin ?? b.company_gstin) !== panOf(b.company_gstin) || !validateGstin(b.venue_gstin).valid) return "not_eligible";
  if (b.itc_decision === "eligible" || b.itc_decision === "blocked") return b.itc_decision;
  return isInvoiced(b.status) ? "review" : "awaiting_invoice";
}

/** The credit that may be claimed: the booking's GST once finance has confirmed it, else nothing. */
export const itcClaimable = (status: ItcStatus, totalTax: number) => (status === "eligible" ? totalTax : 0);

export type ItcTag =
  | "GSTIN_MATCH"
  | "GSTIN_MISMATCH"
  | "SUPPLIER_GSTIN_VALID"
  | "SUPPLIER_GSTIN_INVALID"
  | "SAC_998596"
  | "INTRA_STATE_CGST_SGST"
  | "INTER_STATE_IGST"
  | "ITC_ELIGIBLE"
  | "ITC_BLOCKED"
  | "ITC_PENDING_REVIEW"
  | "ITC_AWAITING_INVOICE"
  | "ITC_NOT_ELIGIBLE";

const STATUS_TAG: Partial<Record<ItcStatus, ItcTag>> = {
  eligible: "ITC_ELIGIBLE",
  blocked: "ITC_BLOCKED",
  review: "ITC_PENDING_REVIEW",
  awaiting_invoice: "ITC_AWAITING_INVOICE",
  not_eligible: "ITC_NOT_ELIGIBLE",
};

/**
 * Machine-readable compliance tags for finance systems and the settlement
 * card: buyer/supplier GSTIN checks, SAC, supply type and ITC status.
 */
export function itcTags(b: ItcInput & { sac_code: string; gst_type: string }): ItcTag[] {
  const status = itcStatusOf(b);
  const tags: ItcTag[] = [
    panOf(b.billed_gstin ?? b.company_gstin) === panOf(b.company_gstin) ? "GSTIN_MATCH" : "GSTIN_MISMATCH",
    validateGstin(b.venue_gstin).valid ? "SUPPLIER_GSTIN_VALID" : "SUPPLIER_GSTIN_INVALID",
  ];
  if (b.sac_code === "998596") tags.push("SAC_998596");
  tags.push(b.gst_type === "IGST" ? "INTER_STATE_IGST" : "INTRA_STATE_CGST_SGST");
  const statusTag = STATUS_TAG[status];
  if (statusTag) tags.push(statusTag);
  return tags;
}

export interface ItcSummary {
  /** GST on bookings finance has confirmed as eligible: claimable. */
  eligible: number;
  /** Invoiced, awaiting finance's decision. */
  pendingReview: number;
  /** Not yet invoiced (upcoming or in progress). */
  awaitingInvoice: number;
  /** Confirmed blocked, or not eligible outright. */
  blocked: number;
  /** Pre-GST value of every non-cancelled booking. */
  committedSpend: number;
}

/** GST per ITC status across a company's bookings. */
export function summariseItc(bookings: readonly (ItcInput & { total_tax: number; total_amount_inr: number })[]): ItcSummary {
  const out: ItcSummary = { eligible: 0, pendingReview: 0, awaitingInvoice: 0, blocked: 0, committedSpend: 0 };
  const add = (k: keyof ItcSummary, n: number) => (out[k] = Math.round((out[k] + n) * 100) / 100);
  for (const b of bookings) {
    const status = itcStatusOf(b);
    if (status === "not_applicable") continue;
    add("committedSpend", Number(b.total_amount_inr));
    if (status === "eligible") add("eligible", b.total_tax);
    else if (status === "review") add("pendingReview", b.total_tax);
    else if (status === "awaiting_invoice") add("awaitingInvoice", b.total_tax);
    else add("blocked", b.total_tax);
  }
  return out;
}
