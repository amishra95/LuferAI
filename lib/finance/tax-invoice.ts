import "server-only";

import { getTaxInvoiceDocument, isIssuedInvoice, listBookings, listCompanies, recordTaxInvoiceDocument } from "@/lib/data";
import { BILLABLE_STATUSES, invoiceWaitingReason } from "@/lib/finance/billing-rules";
import { advanceFor, billedByContract, takeInvoiceNumber, venueAddress } from "@/lib/finance/billing-store";
import { renderTaxInvoice } from "@/lib/finance/tax-invoice-document";
import { todayInIndia } from "@/lib/gst-engine";
import { notifyInvoiceIssued } from "@/lib/services/notifications";

/**
 * Issues a booking's GST tax invoice (tax_invoice_documents), the work of
 * workflows/tax-invoice.ts: once the event has happened, dated that day,
 * numbered in the supplier's FY series, with any deposit already received
 * (its receipt voucher) set against it, then emailed to the company.
 * Idempotent: an issued invoice is final and re-running returns it unchanged.
 * Not due yet, or waiting for the company's billing address: nothing is
 * recorded and the daily sweep tries again (lib/finance/billing-sweep.ts).
 */

const BILLABLE = new Set<string>(BILLABLE_STATUSES);

export type TaxInvoiceJobOutcome =
  | { status: "rendered" | "unchanged"; sha256: string }
  /** Nothing to issue yet (event ahead, no billing address) or ever (billed by contract). */
  | { status: "waiting" | "skipped"; reason: string }
  /** `retryable`: false when trying again can't help (unknown or unconfirmed booking). */
  | { status: "failed"; error: string; retryable: boolean };

function audit(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ audit: "tax_invoice", at: new Date().toISOString(), ...entry }));
}

/** One issuing attempt. Never throws. */
export async function issueTaxInvoiceDocument(bookingId: string, today = todayInIndia()): Promise<TaxInvoiceJobOutcome> {
  let tenantId: string | null = null;
  try {
    const [booking] = await listBookings({ ids: [bookingId] });
    if (!booking) {
      audit({ booking_id: bookingId, status: "failed", error: "Booking not found" });
      return { status: "failed", error: `Booking ${bookingId} not found`, retryable: false };
    }
    tenantId = booking.company_id;
    if (!BILLABLE.has(booking.status)) {
      const error = `Booking ${bookingId} is ${booking.status}, not confirmed`;
      await recordTaxInvoiceDocument(bookingId, tenantId, { status: "failed", error });
      audit({ booking_id: bookingId, status: "failed", error });
      return { status: "failed", error, retryable: false };
    }

    const existing = await getTaxInvoiceDocument(bookingId);
    if (isIssuedInvoice(existing) && existing!.html_sha256) return { status: "unchanged", sha256: existing!.html_sha256 };
    if (await billedByContract(bookingId)) return { status: "skipped", reason: "Billed by contract instalments." };

    const company = (await listCompanies()).find((c) => c.id === booking.company_id);
    const waiting = invoiceWaitingReason(booking, { billing_address: company?.billing_address ?? null }, today);
    if (waiting === "event") return { status: "waiting", reason: "The event hasn't happened yet." };
    if (waiting === "address") return { status: "waiting", reason: "The company hasn't added its billing address." };

    const [supplierAddress, advance] = await Promise.all([venueAddress(booking.venue_id), advanceFor(bookingId)]);
    // Taken last, just before the document is stored, so a failure can't leave a gap in the series.
    const number = await takeInvoiceNumber(booking.venue_id, today);
    const doc = renderTaxInvoice({
      bookingId,
      eventDate: booking.event_date,
      partySize: booking.party_size,
      supplierName: booking.venue.name,
      supplierCity: booking.venue.city,
      supplierAddress,
      recipientName: booking.company.legal_name,
      recipientAddress: company!.billing_address,
      invoice: { ...booking.invoice, invoice_number: number, invoice_date: today },
      advance,
    });
    const row = await recordTaxInvoiceDocument(bookingId, tenantId, {
      status: "rendered",
      invoice_number: number,
      issued_on: today,
      advance_inr: advance.amount,
      receipt_voucher_number: advance.voucherNumber,
      html: doc.html,
      html_sha256: doc.sha256,
    });
    if (row.invoice_number !== number) {
      // A parallel run issued it first; this number goes unused.
      audit({ booking_id: bookingId, status: "unchanged", unused_number: number, invoice_number: row.invoice_number });
      return { status: "unchanged", sha256: row.html_sha256 ?? doc.sha256 };
    }
    audit({ booking_id: bookingId, tenant_id: tenantId, status: "rendered", invoice_number: number, attempts: row.attempts, html_sha256: row.html_sha256 });
    const sent = await notifyInvoiceIssued(booking, { invoiceNumber: number, html: doc.html });
    if (sent.status !== "sent") console.warn(`tax invoice ${number}: email ${sent.status}`, "reason" in sent ? sent.reason : sent.error);
    return { status: "rendered", sha256: row.html_sha256 ?? doc.sha256 };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Issuing failed";
    if (tenantId) await recordTaxInvoiceDocument(bookingId, tenantId, { status: "failed", error }).catch(() => {});
    audit({ booking_id: bookingId, status: "failed", error });
    return { status: "failed", error, retryable: true };
  }
}

/** Closes out an issuing job that gave up: the row becomes 'dead_lettered'. Never throws. */
export async function deadLetterTaxInvoice(bookingId: string, error: string): Promise<void> {
  try {
    const [booking] = await listBookings({ ids: [bookingId] });
    const row = booking ? await recordTaxInvoiceDocument(bookingId, booking.company_id, { status: "dead_lettered", error }) : null;
    audit({ booking_id: bookingId, status: "dead_lettered", attempts: row?.attempts ?? 0, recorded: Boolean(row), error });
  } catch (err) {
    audit({ booking_id: bookingId, status: "dead_lettered", recorded: false, error, record_error: err instanceof Error ? err.message : String(err) });
  }
}
