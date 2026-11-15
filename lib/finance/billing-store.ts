import "server-only";

import { dataSource, getTaxInvoiceDocument, isIssuedInvoice, listBookings, listCompanies } from "@/lib/data";
import { readDb } from "@/lib/data/local-store";
import { indianFiscalYear, invoiceNumber, splitInclusive } from "@/lib/finance/billing-rules";
import { paymentReceiptModel, renderReceiptVoucher, renderRefundVoucher, type BillDocument } from "@/lib/finance/tax-invoice-document";
import type { Json } from "@/lib/supabase/database.types";
import { todayInIndia } from "@/lib/gst-engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Billing data around a booking's documents (migration 20261116000000): the
 * supplier's invoice and voucher series, deposits received, addresses, and
 * issuing receipt vouchers. Live data goes through the service role; callers
 * check who may see what. Payments exist only on the live database.
 */

const live = () => dataSource() === "supabase";

/** The next tax invoice number in the venue's FY series (shared with contract instalments). */
export async function takeInvoiceNumber(venueId: string, on: string): Promise<string> {
  if (!live()) {
    // Local: count the venue's issued invoices this FY.
    const db = await readDb();
    const fy = indianFiscalYear(on);
    const venueOf = new Map(db.bookings.map((b) => [b.id, b.venue_id]));
    const issued = db.taxInvoiceDocuments.filter((d) => d.invoice_number?.startsWith(`${fy}/`) && venueOf.get(d.booking_id) === venueId).length;
    return invoiceNumber(fy, issued + 1);
  }
  const { data, error } = await createAdminClient().rpc("take_venue_invoice_number", { p_venue_id: venueId, p_on: on });
  if (error) throw error;
  return data;
}

/** The venue's street address for the supplier block, or null. */
export async function venueAddress(venueId: string): Promise<string | null> {
  if (!live()) return (await readDb()).venues.find((v) => v.id === venueId)?.address ?? null;
  const { data, error } = await createAdminClient().from("venues").select("address").eq("id", venueId).maybeSingle();
  if (error) throw error;
  return data?.address?.trim() || null;
}

/** The company's billing address for "Bill to", or null until it's given. */
export async function companyBillingAddress(companyId: string): Promise<string | null> {
  return (await listCompanies()).find((c) => c.id === companyId)?.billing_address?.trim() || null;
}

/** True when the booking is billed by contract instalments (booking_invoices): it gets no separate tax invoice. */
export async function billedByContract(bookingId: string): Promise<boolean> {
  if (!live()) return false;
  const { data, error } = await createAdminClient().from("booking_invoices").select("id").eq("booking_id", bookingId).neq("status", "void").limit(1);
  if (error?.code === "42P01" || error?.code === "PGRST205") return false;
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Deposits received for the booking before the event, and the receipt voucher for them (the latest, if several). */
export async function advanceFor(bookingId: string): Promise<{ amount: number; voucherNumber: string | null }> {
  if (!live()) return { amount: 0, voucherNumber: null };
  const db = createAdminClient();
  const [{ data: payments, error }, { data: vouchers, error: vErr }] = await Promise.all([
    db.from("payments").select("amount_inr, refunded_inr").eq("booking_id", bookingId).is("booking_invoice_id", null).eq("purpose", "deposit").eq("status", "captured"),
    db.from("receipt_vouchers").select("voucher_number, created_at").eq("booking_id", bookingId).order("created_at", { ascending: false }),
  ]);
  if (error) throw error;
  if (vErr) throw vErr;
  const amount = Math.round((payments ?? []).reduce((sum, p) => sum + Number(p.amount_inr) - Number(p.refunded_inr), 0) * 100) / 100;
  return { amount, voucherNumber: vouchers?.[0]?.voucher_number ?? null };
}

export type VoucherOutcome = { status: "issued"; voucherNumber: string } | { status: "unchanged"; voucherNumber: string } | { status: "skipped"; reason: string };

/**
 * Issues the receipt voucher for a captured deposit, once. Instalment payments
 * (contracts) settle their own tax invoices and get none. Throws on database
 * errors; callers log and the daily sweep retries.
 */
export async function issueReceiptVoucher(paymentId: string, today = todayInIndia()): Promise<VoucherOutcome> {
  if (!live()) return { status: "skipped", reason: "Payments are live-only." };
  const db = createAdminClient();
  const { data: existing } = await db.from("receipt_vouchers").select("voucher_number").eq("payment_id", paymentId).maybeSingle();
  if (existing) return { status: "unchanged", voucherNumber: existing.voucher_number };

  const { data: payment, error } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (error) throw error;
  if (!payment?.booking_id) return { status: "skipped", reason: "Not a booking payment." };
  if (payment.booking_invoice_id) return { status: "skipped", reason: "Instalment payments settle their own tax invoice." };
  if (payment.purpose !== "deposit") return { status: "skipped", reason: "Only deposits are advances; a balance payment is against the tax invoice." };
  if (payment.status !== "captured") return { status: "skipped", reason: `Payment is ${payment.status}.` };

  const [booking] = await listBookings({ ids: [payment.booking_id] });
  if (!booking) return { status: "skipped", reason: "Booking not found." };
  const [supplierAddress, recipientAddress] = await Promise.all([venueAddress(booking.venue_id), companyBillingAddress(booking.company_id)]);
  const received = splitInclusive(Number(payment.amount_inr), booking.invoice.tax.rate_percent, booking.invoice.gst_type !== "IGST");
  const number = await takeVoucherNumber(booking.venue_id, today);
  const doc = renderReceiptVoucher({
    voucherNumber: number,
    issuedOn: today,
    bookingId: booking.id,
    eventDate: booking.event_date,
    partySize: booking.party_size,
    supplierName: booking.venue.name,
    supplierCity: booking.venue.city,
    supplierAddress,
    recipientName: booking.company.legal_name,
    recipientAddress,
    invoice: booking.invoice,
    received,
    paymentRef: payment.provider_payment_id,
  });
  const { error: insertError } = await db.from("receipt_vouchers").insert({
    payment_id: payment.id,
    booking_id: booking.id,
    tenant_id: booking.company_id,
    venue_id: booking.venue_id,
    voucher_number: number,
    issued_on: today,
    amount_inr: received.total,
    html: doc.html,
    html_sha256: doc.sha256,
    data: doc.model as unknown as Json,
  });
  if (insertError?.code === "23505") {
    // Issued by a parallel run first (this number is left unused).
    console.warn(`receipt voucher: payment ${payment.id} already had one; ${number} unused`);
    const { data: again } = await db.from("receipt_vouchers").select("voucher_number").eq("payment_id", paymentId).maybeSingle();
    return { status: "unchanged", voucherNumber: again?.voucher_number ?? number };
  }
  if (insertError) throw insertError;
  console.info(JSON.stringify({ audit: "receipt_voucher", at: new Date().toISOString(), payment_id: payment.id, booking_id: booking.id, voucher_number: number, html_sha256: doc.sha256 }));
  return { status: "issued", voucherNumber: number };
}

async function takeVoucherNumber(venueId: string, on: string): Promise<string> {
  const { data, error } = await createAdminClient().rpc("take_receipt_voucher_number", { p_venue_id: venueId, p_on: on });
  if (error) throw error;
  return data;
}

/** A booking's receipt vouchers (newest first), for the download route and event page. */
export async function listReceiptVouchers(bookingId: string): Promise<{ payment_id: string; voucher_number: string; issued_on: string; amount_inr: number; html: string; data: Json | null }[]> {
  if (!live()) return [];
  const { data, error } = await createAdminClient()
    .from("receipt_vouchers")
    .select("payment_id, voucher_number, issued_on, amount_inr, html, data")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });
  if (error?.code === "42P01" || error?.code === "PGRST205") return [];
  if (error) throw error;
  return (data ?? []).map((v) => ({ ...v, amount_inr: Number(v.amount_inr) }));
}

/** Captured deposits from the last `days` days that have no receipt voucher yet (the sweep's backlog). */
export async function depositsWithoutVoucher(days = 60): Promise<string[]> {
  if (!live()) return [];
  const db = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [{ data: payments, error }, { data: vouchers, error: vErr }] = await Promise.all([
    db.from("payments").select("id").not("booking_id", "is", null).is("booking_invoice_id", null).eq("purpose", "deposit").eq("status", "captured").gte("captured_at", since),
    db.from("receipt_vouchers").select("payment_id").gte("created_at", since),
  ]);
  if (error) throw error;
  if (vErr?.code === "42P01" || vErr?.code === "PGRST205") return [];
  if (vErr) throw vErr;
  const done = new Set((vouchers ?? []).map((v) => v.payment_id));
  return (payments ?? []).map((p) => p.id).filter((id) => !done.has(id));
}

/** Issued invoice numbers by booking, for lists (venue booking history). */
export async function issuedInvoiceNumbers(bookingIds: string[]): Promise<Map<string, string>> {
  if (bookingIds.length === 0) return new Map();
  if (!live()) {
    const ids = new Set(bookingIds);
    return new Map((await readDb()).taxInvoiceDocuments.filter((d) => ids.has(d.booking_id) && d.invoice_number).map((d) => [d.booking_id, d.invoice_number!]));
  }
  const { data, error } = await createAdminClient().from("tax_invoice_documents").select("booking_id, invoice_number").in("booking_id", bookingIds).not("invoice_number", "is", null);
  if (error) throw error;
  return new Map((data ?? []).map((d) => [d.booking_id, d.invoice_number!]));
}

// ----------------------------------------------------------------------------
// Refund vouchers (a deposit returned before any tax invoice)
// ----------------------------------------------------------------------------

/**
 * Issues the refund voucher for a refund of a booking's deposit, once. Only
 * while the booking has no issued tax invoice: after that, a refund needs a
 * credit note against the invoice instead, which isn't issued here. Throws on
 * database errors.
 */
export async function issueRefundVoucher(refundId: string, today = todayInIndia()): Promise<VoucherOutcome> {
  if (!live()) return { status: "skipped", reason: "Payments are live-only." };
  const db = createAdminClient();
  const { data: existing } = await db.from("refund_vouchers").select("voucher_number").eq("refund_id", refundId).maybeSingle();
  if (existing) return { status: "unchanged", voucherNumber: existing.voucher_number };

  const { data: refund, error } = await db.from("payment_refunds").select("*").eq("id", refundId).maybeSingle();
  if (error) throw error;
  if (!refund || refund.status === "failed") return { status: "skipped", reason: "No refund to document." };
  const { data: payment, error: pErr } = await db.from("payments").select("*").eq("id", refund.payment_id).maybeSingle();
  if (pErr) throw pErr;
  if (!payment?.booking_id || payment.purpose !== "deposit" || payment.booking_invoice_id) return { status: "skipped", reason: "Not a booking deposit." };
  if (isIssuedInvoice(await getTaxInvoiceDocument(payment.booking_id))) return { status: "skipped", reason: "A tax invoice is issued: this refund needs a credit note." };

  const [booking] = await listBookings({ ids: [payment.booking_id] });
  if (!booking) return { status: "skipped", reason: "Booking not found." };
  const [supplierAddress, recipientAddress, { data: receipt }] = await Promise.all([
    venueAddress(booking.venue_id),
    companyBillingAddress(booking.company_id),
    db.from("receipt_vouchers").select("voucher_number").eq("payment_id", payment.id).maybeSingle(),
  ]);
  const refunded = splitInclusive(Number(refund.amount_inr), booking.invoice.tax.rate_percent, booking.invoice.gst_type !== "IGST");
  const { data: number, error: nErr } = await db.rpc("take_refund_voucher_number", { p_venue_id: booking.venue_id, p_on: today });
  if (nErr) throw nErr;
  const doc = renderRefundVoucher({
    voucherNumber: number,
    issuedOn: today,
    bookingId: booking.id,
    eventDate: booking.event_date,
    supplierName: booking.venue.name,
    supplierCity: booking.venue.city,
    supplierAddress,
    recipientName: booking.company.legal_name,
    recipientAddress,
    invoice: booking.invoice,
    refunded,
    receiptVoucherNumber: receipt?.voucher_number ?? null,
    refundRef: refund.provider_refund_id,
  });
  const { error: insertError } = await db.from("refund_vouchers").insert({
    refund_id: refund.id,
    booking_id: booking.id,
    tenant_id: booking.company_id,
    venue_id: booking.venue_id,
    voucher_number: number,
    issued_on: today,
    amount_inr: refunded.total,
    html: doc.html,
    html_sha256: doc.sha256,
    data: doc.model as unknown as Json,
  });
  if (insertError?.code === "23505") {
    const { data: again } = await db.from("refund_vouchers").select("voucher_number").eq("refund_id", refundId).maybeSingle();
    return { status: "unchanged", voucherNumber: again?.voucher_number ?? number };
  }
  if (insertError) throw insertError;
  console.info(JSON.stringify({ audit: "refund_voucher", at: new Date().toISOString(), refund_id: refund.id, booking_id: booking.id, voucher_number: number, html_sha256: doc.sha256 }));
  return { status: "issued", voucherNumber: number };
}

/** A booking's refund vouchers (newest first). */
export async function listRefundVouchers(bookingId: string): Promise<{ refund_id: string; voucher_number: string; issued_on: string; amount_inr: number; html: string; data: Json | null }[]> {
  if (!live()) return [];
  const { data, error } = await createAdminClient()
    .from("refund_vouchers")
    .select("refund_id, voucher_number, issued_on, amount_inr, html, data")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });
  if (error?.code === "42P01" || error?.code === "PGRST205") return [];
  if (error) throw error;
  return (data ?? []).map((v) => ({ ...v, amount_inr: Number(v.amount_inr) }));
}

/** Refunds from the last `days` days that should have a refund voucher and don't (the sweep's backlog). */
export async function refundsWithoutVoucher(days = 60): Promise<string[]> {
  if (!live()) return [];
  const db = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [{ data: refunds, error }, { data: vouchers, error: vErr }] = await Promise.all([
    db.from("payment_refunds").select("id").neq("status", "failed").gte("created_at", since),
    db.from("refund_vouchers").select("refund_id").gte("created_at", since),
  ]);
  if (error?.code === "42P01" || error?.code === "PGRST205" || vErr?.code === "42P01" || vErr?.code === "PGRST205") return [];
  if (error) throw error;
  if (vErr) throw vErr;
  const done = new Set((vouchers ?? []).map((v) => v.refund_id));
  return (refunds ?? []).map((r) => r.id).filter((id) => !done.has(id));
}

// ----------------------------------------------------------------------------
// Payment receipt (the balance, paid against the issued invoice)
// ----------------------------------------------------------------------------

/**
 * The receipt for the booking's latest captured balance payment, built from
 * the payment and the issued invoice (nothing is stored: it isn't a numbered
 * GST document). Null when there's no such payment.
 */
export async function paymentReceiptFor(bookingId: string): Promise<BillDocument | null> {
  if (!live()) return null;
  const db = createAdminClient();
  const invoice = await getTaxInvoiceDocument(bookingId);
  if (!isIssuedInvoice(invoice)) return null;
  const { data: payments, error } = await db.from("payments").select("*").eq("booking_id", bookingId).eq("purpose", "balance").eq("status", "captured").order("captured_at", { ascending: false }).limit(1);
  if (error) throw error;
  const payment = payments?.[0];
  if (!payment) return null;
  const [booking] = await listBookings({ ids: [bookingId] });
  if (!booking) return null;
  const [supplierAddress, recipientAddress] = await Promise.all([venueAddress(booking.venue_id), companyBillingAddress(booking.company_id)]);
  return paymentReceiptModel({
    invoiceNumber: invoice!.invoice_number!,
    invoiceDate: invoice!.issued_on ?? booking.event_date,
    paidOn: todayInIndia(new Date(payment.captured_at ?? payment.updated_at)),
    bookingId,
    eventDate: booking.event_date,
    supplierName: booking.venue.name,
    supplierCity: booking.venue.city,
    supplierAddress,
    recipientName: booking.company.legal_name,
    recipientAddress,
    invoice: booking.invoice,
    advance: Number(invoice!.advance_inr),
    paid: Number(payment.amount_inr),
    paymentRef: payment.provider_payment_id,
  });
}
