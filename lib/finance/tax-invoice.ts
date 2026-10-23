import "server-only";

import { getTaxInvoiceDocument, listBookings, recordTaxInvoiceDocument } from "@/lib/data";
import { renderTaxInvoice } from "@/lib/finance/tax-invoice-document";

/**
 * Renders and stores a booking's tax invoice document (tax_invoice_documents),
 * the work of workflows/tax-invoice.ts. Idempotent: a rendered document is
 * final and re-running returns it unchanged.
 */

/** Statuses with an invoice to render: confirmed onwards (as for expense exports). */
const INVOICED = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);

export type TaxInvoiceJobOutcome =
  | { status: "rendered" | "unchanged"; sha256: string }
  /** `retryable`: false when trying again can't help (unknown or unconfirmed booking). */
  | { status: "failed"; error: string; retryable: boolean };

function audit(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ audit: "tax_invoice", at: new Date().toISOString(), ...entry }));
}

/** One render attempt, recorded on the booking's row. Never throws. */
export async function issueTaxInvoiceDocument(bookingId: string): Promise<TaxInvoiceJobOutcome> {
  let tenantId: string | null = null;
  try {
    const [booking] = await listBookings({ ids: [bookingId] });
    if (!booking) {
      audit({ booking_id: bookingId, status: "failed", error: "Booking not found" });
      return { status: "failed", error: `Booking ${bookingId} not found`, retryable: false };
    }
    tenantId = booking.company_id;
    if (!INVOICED.has(booking.status)) {
      const error = `Booking ${bookingId} is ${booking.status}, not confirmed`;
      await recordTaxInvoiceDocument(bookingId, tenantId, { status: "failed", error });
      audit({ booking_id: bookingId, status: "failed", error });
      return { status: "failed", error, retryable: false };
    }

    const existing = await getTaxInvoiceDocument(bookingId);
    if (existing?.status === "rendered" && existing.html_sha256) return { status: "unchanged", sha256: existing.html_sha256 };

    const doc = renderTaxInvoice({
      bookingId,
      eventDate: booking.event_date,
      partySize: booking.party_size,
      supplierName: booking.venue.name,
      supplierCity: booking.venue.city,
      recipientName: booking.company.legal_name,
      invoice: booking.invoice,
    });
    const row = await recordTaxInvoiceDocument(bookingId, tenantId, { status: "rendered", invoice_number: doc.invoiceNumber, html: doc.html, html_sha256: doc.sha256 });
    audit({ booking_id: bookingId, tenant_id: tenantId, status: "rendered", attempts: row.attempts, html_sha256: row.html_sha256 });
    return { status: "rendered", sha256: row.html_sha256 ?? doc.sha256 };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Rendering failed";
    if (tenantId) await recordTaxInvoiceDocument(bookingId, tenantId, { status: "failed", error }).catch(() => {});
    audit({ booking_id: bookingId, status: "failed", error });
    return { status: "failed", error, retryable: true };
  }
}

/** Closes out a render job that gave up: the row becomes 'dead_lettered'. Never throws. */
export async function deadLetterTaxInvoice(bookingId: string, error: string): Promise<void> {
  try {
    const [booking] = await listBookings({ ids: [bookingId] });
    const row = booking ? await recordTaxInvoiceDocument(bookingId, booking.company_id, { status: "dead_lettered", error }) : null;
    audit({ booking_id: bookingId, status: "dead_lettered", attempts: row?.attempts ?? 0, recorded: Boolean(row), error });
  } catch (err) {
    audit({ booking_id: bookingId, status: "dead_lettered", recorded: false, error, record_error: err instanceof Error ? err.message : String(err) });
  }
}
