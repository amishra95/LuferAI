import "server-only";

import { dataSource } from "@/lib/data";
import { readDb } from "@/lib/data/local-store";
import { invoiceDue } from "@/lib/finance/billing-rules";
import { depositsWithoutVoucher, issueReceiptVoucher } from "@/lib/finance/billing-store";
import { issueTaxInvoiceDocument } from "@/lib/finance/tax-invoice";
import { todayInIndia } from "@/lib/gst-engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The daily billing sweep (app/api/cron/issue-invoices): receipt vouchers for
 * deposits that have none (a webhook capture, or a voucher that failed), and
 * tax invoices for events that have happened but aren't billed yet (the venue
 * never marked them complete, or the company's billing address arrived late).
 * Bounded per run; anything left is picked up the next day.
 */

const LOOKBACK_DAYS = 120;
const MAX_PER_RUN = 50;

/** Bookings whose invoice is due (event happened) and not yet issued, oldest event first. */
async function bookingsToInvoice(today: string, companyId?: string): Promise<string[]> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (dataSource() !== "supabase") {
    const db = await readDb();
    const issued = new Set(db.taxInvoiceDocuments.filter((d) => d.invoice_number).map((d) => d.booking_id));
    return db.bookings
      .filter((b) => (!companyId || b.company_id === companyId) && b.event_date >= since && invoiceDue(b, today) && !issued.has(b.id))
      .sort((a, b) => a.event_date.localeCompare(b.event_date))
      .map((b) => b.id);
  }
  const db = createAdminClient();
  let query = db
    .from("bookings")
    .select("id, status, event_date")
    .in("status", ["CONFIRMED", "COMPLETED", "SETTLED"])
    .gte("event_date", since)
    .order("event_date");
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw error;
  const due = (data ?? []).filter((b) => invoiceDue(b, today));
  if (due.length === 0) return [];
  const { data: docs, error: docErr } = await db
    .from("tax_invoice_documents")
    .select("booking_id")
    .in("booking_id", due.map((b) => b.id))
    .not("invoice_number", "is", null);
  if (docErr) throw docErr;
  const issued = new Set((docs ?? []).map((d) => d.booking_id));
  return due.filter((b) => !issued.has(b.id)).map((b) => b.id);
}

export interface BillingSweepResult {
  vouchers: number;
  invoices: number;
  waiting: number;
  failed: number;
}

export async function runDocumentSweep(today = todayInIndia(), companyId?: string): Promise<BillingSweepResult> {
  const result: BillingSweepResult = { vouchers: 0, invoices: 0, waiting: 0, failed: 0 };

  // Vouchers first: an invoice issued in the same run then sets the deposit against it by number.
  if (!companyId) {
    for (const paymentId of (await depositsWithoutVoucher()).slice(0, MAX_PER_RUN)) {
      try {
        if ((await issueReceiptVoucher(paymentId, today)).status === "issued") result.vouchers++;
      } catch (err) {
        result.failed++;
        console.error(`billing sweep: receipt voucher for payment ${paymentId} failed`, err);
      }
    }
  }

  for (const bookingId of (await bookingsToInvoice(today, companyId)).slice(0, MAX_PER_RUN)) {
    const outcome = await issueTaxInvoiceDocument(bookingId, today);
    if (outcome.status === "rendered") result.invoices++;
    else if (outcome.status === "waiting") result.waiting++;
    else if (outcome.status === "failed") result.failed++;
  }
  return result;
}

/** After a company adds its billing address: issue the invoices that were waiting for it. Never throws. */
export async function issueWaitingInvoices(companyId: string): Promise<void> {
  try {
    const r = await runDocumentSweep(todayInIndia(), companyId);
    if (r.invoices || r.failed) console.info(JSON.stringify({ audit: "billing_address_added", company_id: companyId, ...r }));
  } catch (err) {
    console.error(`billing: issuing waiting invoices for ${companyId} failed`, err);
  }
}
