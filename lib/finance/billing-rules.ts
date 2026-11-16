/**
 * When a booking is billed, and the sums on its documents (migration
 * 20261116000000). Pure: tests import it directly.
 *
 * - Receipt voucher: when a deposit is received before the event (GST on an
 *   advance for services is due on receipt). The deposit includes GST, so it's
 *   split back into taxable value and tax at the booking's rate.
 * - Tax invoice: once the event has happened, i.e. the venue marked it
 *   COMPLETED (or it's SETTLED), or it's CONFIRMED and its date has passed.
 *   Dated the day it's issued, numbered in the supplier's FY series, with the
 *   advance already received set against it.
 * - Bookings billed by contract instalments (booking_invoices) already have
 *   their tax invoices; they get no second one.
 */

export const BILLABLE_STATUSES = ["CONFIRMED", "COMPLETED", "SETTLED"] as const;

/** The event has happened, so the supply is complete and the invoice is due. */
export function invoiceDue(booking: { status: string; event_date: string }, today: string): boolean {
  if (booking.status === "COMPLETED" || booking.status === "SETTLED") return true;
  return booking.status === "CONFIRMED" && booking.event_date < today;
}

/** Why an invoice can't be issued yet, in words for the event page (null: it can). */
export function invoiceWaitingReason(
  booking: { status: string; event_date: string },
  company: { billing_address: string | null },
  today: string
): "event" | "address" | null {
  if (!invoiceDue(booking, today)) return "event";
  if (!company.billing_address?.trim()) return "address";
  return null;
}

/** 'YYYY-YY' for the Indian FY (April–March) containing a date (YYYY-MM-DD). Mirrors public.indian_fiscal_year. */
export function indianFiscalYear(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** '2026-27/000001', the format of the supplier's invoice series (as booking_invoices). */
export const invoiceNumber = (fiscalYear: string, n: number) => `${fiscalYear}/${String(n).padStart(6, "0")}`;

/** 'RV/2026-27/000001', the supplier's receipt voucher series. */
export const voucherNumber = (fiscalYear: string, n: number) => `RV/${invoiceNumber(fiscalYear, n)}`;

const paise = (inr: number) => Math.round(inr * 100);
const rupees = (p: number) => p / 100;

/**
 * Splits an amount received that includes GST at `ratePercent` into taxable
 * value and tax, CGST + SGST when intra-state (halves, any odd paisa to CGST),
 * else IGST. The parts always add back up to the amount.
 */
export function splitInclusive(amountInr: number, ratePercent: number, intraState: boolean) {
  const total = paise(amountInr);
  const taxable = Math.round((total * 100) / (100 + ratePercent));
  const tax = total - taxable;
  const sgst = intraState ? Math.floor(tax / 2) : 0;
  const cgst = intraState ? tax - sgst : 0;
  const igst = intraState ? 0 : tax;
  return { total: rupees(total), taxable: rupees(taxable), tax: rupees(tax), cgst: rupees(cgst), sgst: rupees(sgst), igst: rupees(igst) };
}

/** What's left to pay on an invoice after the advance (never below zero). */
export const balanceDue = (invoiceTotal: number, advance: number) => rupees(Math.max(0, paise(invoiceTotal) - paise(advance)));
