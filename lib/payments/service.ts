import "server-only";

import type { Member } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { calculateGst, roundInr, splitCommission, type TaxInvoicePayload } from "@/lib/gst-engine";
import { applyTransferUpdate, syncOrderSettlement } from "@/lib/marketplace/service";
import { depositFor } from "@/lib/quotes";
import { depositRateFor } from "@/lib/rates/venue-pricing";
import { issueReceiptVoucher, issueRefundVoucher } from "@/lib/finance/billing-store";
import { getTaxInvoiceDocument, isIssuedInvoice, listBookings } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVenuePricing } from "@/lib/venues/pricing-store";
import type { Json, Payment, PaymentProvider, PaymentStatus } from "@/lib/supabase/database.types";
import { getCheckoutGateway, getGateway, type DepositCheckout, type NormalizedEvent, type RefundUpdate } from "./gateways";
import { afterRefund, afterRefundFailed, invoiceOutstanding, refundRefusal } from "./rules";
import { isPayableRequest, paidAlert } from "@/lib/concierge/requests";
import { notifyOps } from "@/lib/services/notifications";
import { sendTelegram } from "@/lib/services/telegram";
import { listedGstin } from "@/lib/venues/gstin";
import { billableGstin } from "@/lib/companies/gstin";

/** GST invoice metadata snapshotted onto payments.invoice. */
export interface DepositInvoice extends TaxInvoicePayload {
  /** Party size × per-head before the corporate rate card. */
  list_amount: number;
  rate_card_id: string | null;
  /** list_amount − taxable_value (0 without a rate card). */
  rate_card_savings: number;
  deposit_rate: number;
  deposit_amount: number;
  balance_due: number;
}

export class PaymentError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    message: string
  ) {
    super(message);
  }
}

const toPaise = (inr: number) => Math.round(Number((inr * 100).toPrecision(15)));

export const paymentsEnabled = () => dataSource() === "supabase" && getCheckoutGateway() !== null;

// ----------------------------------------------------------------------------
// Checkout
// ----------------------------------------------------------------------------

export async function createDepositCheckout(
  bookingId: string,
  member: Member,
  origin: string
): Promise<{ checkout: DepositCheckout; invoice: DepositInvoice }> {
  const gateway = getCheckoutGateway();
  if (dataSource() !== "supabase" || !gateway) throw new PaymentError(503, "Payments are not configured.");

  const db = createAdminClient();
  const { data: booking } = await db
    .from("bookings")
    .select("*, company:companies(legal_name, gstin, primary_contact_email), venue:venues(name, gstin)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) throw new PaymentError(404, "Booking not found.");
  if (member.role !== "ADMIN" && booking.company_id !== member.companyId) {
    throw new PaymentError(403, "This booking belongs to another company.");
  }
  if (booking.status !== "PENDING") throw new PaymentError(409, `Deposits are taken on pending bookings (this one is ${booking.status}).`);

  const { data: live } = await db
    .from("payments")
    .select("id")
    .eq("booking_id", bookingId)
    .in("status", ["authorized", "captured"])
    .maybeSingle();
  if (live) throw new PaymentError(409, "A deposit is already authorised for this booking.");

  // total_amount_inr is already at the negotiated per-head (lib/rates, at booking time).
  const taxable = Number(booking.total_amount_inr);
  const list = roundInr(booking.party_size * Number(booking.list_budget_per_head_inr ?? booking.budget_per_head_inr));
  const gst = calculateGst({
    total_amount: taxable,
    company_gstin: billableGstin(booking.company!),
    venue_gstin: listedGstin(booking.venue!),
    booking_id: booking.id,
    invoice_date: booking.event_date,
  });
  // The venue's deposit (venue_pricing_rules), else the platform default; fixed on the payment row once authorised.
  const depositRate = depositRateFor((await getVenuePricing(booking.venue_id)).pricing);
  const deposit = depositFor(gst.invoice_total, depositRate);
  const invoice: DepositInvoice = {
    ...gst,
    list_amount: list,
    rate_card_id: booking.rate_card_id,
    rate_card_savings: roundInr(Math.max(0, list - taxable)),
    deposit_rate: depositRate,
    deposit_amount: deposit,
    balance_due: splitCommission(gst.invoice_total, depositRate).venue_payout,
  };

  const paymentId = crypto.randomUUID();
  const checkout = await gateway.createDepositCheckout({
    paymentId,
    subject: { kind: "booking", id: bookingId },
    amountPaise: toPaise(deposit),
    description: `Deposit · ${booking.venue!.name} · ${booking.event_date}`,
    customerEmail: member.email ?? booking.company!.primary_contact_email,
    successUrl: `${origin}/client?deposit=success`,
    cancelUrl: `${origin}/client?deposit=cancelled`,
    billing: { customerLegalName: booking.company!.legal_name, invoice: gst, depositInr: deposit },
  });

  const { error } = await db.from("payments").insert({
    id: paymentId,
    booking_id: bookingId,
    purpose: "deposit",
    provider: gateway.name,
    amount_inr: deposit,
    deposit_rate: depositRate,
    provider_order_id: checkout.orderId,
    invoice: invoice as unknown as Json,
  });
  if (error) throw error;

  return { checkout, invoice };
}

/**
 * Pays an issued instalment invoice of an executed contract (migration 0031). The
 * booking is already confirmed, so the authorisation is captured as soon as the
 * webhook reports it (captureInstalment below), and the payments_settle_invoice
 * trigger marks the invoice paid.
 */
export async function createInvoiceCheckout(
  invoiceId: string,
  member: Member,
  origin: string
): Promise<{ checkout: DepositCheckout; invoice: TaxInvoicePayload }> {
  const gateway = getCheckoutGateway();
  if (dataSource() !== "supabase" || !gateway) throw new PaymentError(503, "Payments are not configured.");

  const db = createAdminClient();
  const { data: inv } = await db
    .from("booking_invoices")
    .select("*, booking:bookings(id, status, event_date, total_amount_inr, billing_gstin, company:companies(legal_name, gstin, primary_contact_email), venue:venues(name, gstin))")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv?.booking) throw new PaymentError(404, "Invoice not found.");
  if (member.role !== "ADMIN" && inv.tenant_id !== member.companyId) throw new PaymentError(403, "This invoice belongs to another company.");
  if (inv.status !== "issued") throw new PaymentError(409, inv.status === "paid" ? "This invoice is already paid." : `This invoice is ${inv.status} and can't be paid now.`);
  const booking = inv.booking;
  if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") throw new PaymentError(409, `The booking is ${booking.status.toLowerCase()}.`);

  const { data: live } = await db.from("payments").select("id").eq("booking_invoice_id", invoiceId).in("status", ["authorized", "captured"]).maybeSingle();
  if (live) throw new PaymentError(409, "A payment is already authorised for this invoice.");

  const total = Number(inv.total_inr);
  const gst = calculateGst({
    total_amount: Number(booking.total_amount_inr),
    company_gstin: booking.billing_gstin ?? billableGstin(booking.company!),
    venue_gstin: listedGstin(booking.venue!),
    booking_id: booking.id,
    invoice_date: booking.event_date,
  });
  const paymentId = crypto.randomUUID();
  const checkout = await gateway.createDepositCheckout({
    paymentId,
    subject: { kind: "booking", id: booking.id },
    amountPaise: toPaise(total),
    description: `Invoice ${inv.invoice_number} · ${inv.kind} · ${booking.venue!.name} · ${booking.event_date}`,
    customerEmail: member.email ?? booking.company!.primary_contact_email,
    successUrl: `${origin}/contracts/${inv.contract_id}?payment=success`,
    cancelUrl: `${origin}/contracts/${inv.contract_id}?payment=cancelled`,
    billing: { customerLegalName: booking.company!.legal_name, invoice: gst, depositInr: total },
  });

  const { error } = await db.from("payments").insert({
    id: paymentId,
    booking_id: booking.id,
    booking_invoice_id: invoiceId,
    purpose: "instalment",
    provider: gateway.name,
    amount_inr: total,
    // The instalment's share of the booking's invoice.
    deposit_rate: Math.min(1, Math.max(0.0001, Math.round((total / gst.invoice_total) * 10_000) / 10_000)),
    provider_order_id: checkout.orderId,
    invoice: { ...gst, instalment: { id: inv.id, kind: inv.kind, invoice_number: inv.invoice_number, total_inr: total } } as unknown as Json,
  });
  if (error) throw error;
  return { checkout, invoice: gst };
}

/** Balance payments captured for a booking, net of refunds. */
async function balancePaid(bookingId: string): Promise<number> {
  const { data, error } = await createAdminClient().from("payments").select("amount_inr, refunded_inr").eq("booking_id", bookingId).eq("purpose", "balance").eq("status", "captured");
  if (error) throw error;
  return roundInr((data ?? []).reduce((sum, p) => sum + Number(p.amount_inr) - Number(p.refunded_inr), 0));
}

/**
 * What a booking's issued tax invoice still has to pay (null: no issued
 * invoice, e.g. the event hasn't happened or it's billed by contract).
 */
export async function invoiceBalance(bookingId: string): Promise<{ invoiceNumber: string; total: number; advance: number; paid: number; outstanding: number } | null> {
  if (dataSource() !== "supabase") return null;
  const doc = await getTaxInvoiceDocument(bookingId);
  if (!isIssuedInvoice(doc)) return null;
  const [booking] = await listBookings({ ids: [bookingId] });
  if (!booking) return null;
  const total = booking.invoice.invoice_total;
  const advance = Number(doc!.advance_inr);
  const paid = await balancePaid(bookingId);
  return { invoiceNumber: doc!.invoice_number!, total, advance, paid, outstanding: invoiceOutstanding(total, advance, paid) };
}

/**
 * Pays what's left on a booking's issued tax invoice (invoice total less the
 * deposit set against it). The event has happened, so the authorisation is
 * captured as soon as the provider reports it, like a contract instalment.
 */
export async function createBalanceCheckout(
  bookingId: string,
  member: Member,
  origin: string
): Promise<{ checkout: DepositCheckout; amountInr: number }> {
  const gateway = getCheckoutGateway();
  if (dataSource() !== "supabase" || !gateway) throw new PaymentError(503, "Payments are not configured.");

  const db = createAdminClient();
  const { data: booking } = await db
    .from("bookings")
    .select("*, company:companies(legal_name, gstin, primary_contact_email), venue:venues(name, gstin)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) throw new PaymentError(404, "Booking not found.");
  if (member.role !== "ADMIN" && booking.company_id !== member.companyId) throw new PaymentError(403, "This booking belongs to another company.");
  if (booking.status === "CANCELLED") throw new PaymentError(409, "This booking was cancelled.");

  const balance = await invoiceBalance(bookingId);
  if (!balance) throw new PaymentError(409, "The balance is paid against the tax invoice, which is issued after the event.");
  if (balance.outstanding <= 0) throw new PaymentError(409, "This invoice is already paid in full.");

  const { data: live } = await db.from("payments").select("id").eq("booking_id", bookingId).eq("purpose", "balance").eq("status", "authorized").maybeSingle();
  if (live) throw new PaymentError(409, "A balance payment is already being processed for this booking.");

  const gst = calculateGst({
    total_amount: Number(booking.total_amount_inr),
    company_gstin: booking.billing_gstin ?? billableGstin(booking.company!),
    venue_gstin: listedGstin(booking.venue!),
    booking_id: booking.id,
    invoice_date: booking.event_date,
  });
  const paymentId = crypto.randomUUID();
  const checkout = await gateway.createDepositCheckout({
    paymentId,
    subject: { kind: "booking", id: bookingId },
    amountPaise: toPaise(balance.outstanding),
    description: `Invoice ${balance.invoiceNumber} · balance · ${booking.venue!.name} · ${booking.event_date}`,
    customerEmail: member.email ?? booking.company!.primary_contact_email,
    successUrl: `${origin}/client/events/${bookingId}?payment=success`,
    cancelUrl: `${origin}/client/events/${bookingId}?payment=cancelled`,
    billing: { customerLegalName: booking.company!.legal_name, invoice: gst, depositInr: balance.outstanding },
  });

  const { error } = await db.from("payments").insert({
    id: paymentId,
    booking_id: bookingId,
    purpose: "balance",
    provider: gateway.name,
    amount_inr: balance.outstanding,
    deposit_rate: Math.min(1, Math.max(0.0001, Math.round((balance.outstanding / balance.total) * 10_000) / 10_000)),
    provider_order_id: checkout.orderId,
    invoice: { ...gst, balance: { invoice_number: balance.invoiceNumber, advance_inr: balance.advance, amount_inr: balance.outstanding } } as unknown as Json,
  });
  if (error) throw error;
  return { checkout, amountInr: balance.outstanding };
}

/**
 * Pays an accepted concierge quote in full (lib/concierge/requests.ts). The
 * company has already agreed the price with Lufer, so the authorisation is
 * captured as soon as the provider reports it. There is no booking and no GST
 * snapshot: the venue has no account here, and the company gets a payment
 * receipt (lib/finance/request-receipt.ts).
 */
export async function createRequestCheckout(requestId: string, member: Member, origin: string): Promise<{ checkout: DepositCheckout; amountInr: number }> {
  const gateway = getCheckoutGateway();
  if (dataSource() !== "supabase" || !gateway) throw new PaymentError(503, "Payments are not configured.");

  const db = createAdminClient();
  const { data: request } = await db.from("concierge_requests").select("*").eq("id", requestId).maybeSingle();
  if (!request) throw new PaymentError(404, "Request not found.");
  const company = request.company_id ? (await db.from("companies").select("legal_name, primary_contact_email").eq("id", request.company_id).maybeSingle()).data : null;
  if (member.role !== "ADMIN" && (!request.company_id || request.company_id !== member.companyId)) throw new PaymentError(403, "This request belongs to another company.");
  if (!isPayableRequest(request)) throw new PaymentError(409, request.status === "quoted" ? "Accept the quote first." : "There is no accepted quote to pay on this request.");

  const { data: live } = await db.from("payments").select("status").eq("concierge_request_id", requestId).in("status", ["authorized", "captured"]).maybeSingle();
  if (live) throw new PaymentError(409, live.status === "captured" ? "This quote is already paid." : "A payment is already being processed for this quote.");

  const total = roundInr(Number(request.quote_total_inr));
  const paymentId = crypto.randomUUID();
  const checkout = await gateway.createDepositCheckout({
    paymentId,
    subject: { kind: "request", id: requestId },
    amountPaise: toPaise(total),
    description: `${request.venue_name ?? "Event"} · ${request.event_date ?? ""}`.trim(),
    customerEmail: member.email ?? company?.primary_contact_email ?? request.requester_email,
    successUrl: `${origin}/client?payment=success`,
    cancelUrl: `${origin}/client?payment=cancelled`,
    billing: { customerLegalName: company?.legal_name ?? request.requester_email, depositInr: total },
  });

  const { error } = await db.from("payments").insert({
    id: paymentId,
    concierge_request_id: requestId,
    purpose: "request",
    provider: gateway.name,
    amount_inr: total,
    deposit_rate: 1,
    provider_order_id: checkout.orderId,
    // What was agreed, as it stood when the payment started.
    invoice: { concierge_quote: { venue_name: request.venue_name, event_date: request.event_date, guests: request.guests, total_inr: total, note: request.quote_note, accepted_at: request.accepted_at } } as unknown as Json,
  });
  if (error) throw error;
  return { checkout, amountInr: total };
}

/** Tells Lufer ops a concierge quote was paid. Never throws. */
async function alertRequestPaid(requestId: string, paymentRef: string | null) {
  try {
    const db = createAdminClient();
    const { data: request } = await db.from("concierge_requests").select("*").eq("id", requestId).maybeSingle();
    if (!request) return;
    const company = request.company_id ? (await db.from("companies").select("legal_name").eq("id", request.company_id).maybeSingle()).data : null;
    const message = paidAlert(request, { companyName: company?.legal_name ?? request.requester_email }, paymentRef);
    await Promise.all([notifyOps(message), sendTelegram([message.subject, ...message.lines].join("\n"))]);
  } catch (err) {
    console.error(`concierge: paid alert for request ${requestId} failed`, err);
  }
}

/** An instalment's or balance payment's authorisation is captured at once: there's no venue decision left to wait for. */
async function captureInstalment(paymentId: string) {
  const db = createAdminClient();
  const { data: payment } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (!payment || payment.status !== "authorized" || !payment.provider_payment_id) return;
  try {
    const gateway = getGateway(payment.provider);
    if (!gateway) throw new Error(`${payment.provider} is not configured`);
    await gateway.capture(payment.provider_payment_id, toPaise(Number(payment.amount_inr)));
    await db.from("payments").update({ status: "captured", captured_at: new Date().toISOString(), last_error: null }).eq("id", payment.id);
    if (payment.concierge_request_id) await alertRequestPaid(payment.concierge_request_id, payment.provider_payment_id);
  } catch (err) {
    console.error(`Instalment capture failed for payment ${payment.id}`, err);
    // Only while it's still uncaptured: a second report of the same authorisation loses the race harmlessly.
    await db.from("payments").update({ last_error: `capture failed: ${err instanceof Error ? err.message : String(err)}` }).eq("id", payment.id).eq("status", "authorized");
  }
}

// ----------------------------------------------------------------------------
// Webhooks
// ----------------------------------------------------------------------------

/** Status moves a webhook may make; anything else is an out-of-order or replayed event. */
const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  created: ["authorized", "captured", "voided", "failed"],
  failed: ["authorized", "captured"], // a retry on the same order can still succeed
  authorized: ["captured", "voided"],
  captured: ["refunded"],
  voided: [],
  refunded: [],
};

const TIMESTAMP: Partial<Record<PaymentStatus, "authorized_at" | "captured_at" | "voided_at">> = {
  authorized: "authorized_at",
  captured: "captured_at",
  voided: "voided_at",
};

async function findPayment(provider: PaymentProvider, e: Pick<NormalizedEvent, "paymentId" | "orderId" | "paymentRef">) {
  const db = createAdminClient();
  const base = () => db.from("payments").select("*").eq("provider", provider);
  if (e.paymentId) {
    const { data } = await base().eq("id", e.paymentId).maybeSingle();
    if (data) return data;
  }
  if (e.orderId) {
    const { data } = await base().eq("provider_order_id", e.orderId).maybeSingle();
    if (data) return data;
  }
  if (e.paymentRef) {
    const { data } = await base().eq("provider_payment_id", e.paymentRef).maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Applies a verified webhook. Idempotent: replays and out-of-order events are no-ops. */
export async function applyWebhookEvent(provider: PaymentProvider, event: NormalizedEvent): Promise<"applied" | "duplicate" | "ignored"> {
  const db = createAdminClient();

  const { data: seen } = await db
    .from("payment_events")
    .select("event_id")
    .eq("provider", provider)
    .eq("event_id", event.eventId)
    .maybeSingle();
  if (seen) return "duplicate";

  // Razorpay Route transfer.* events update partner payouts, not payments.
  if (event.transfer) {
    const outcome = await applyTransferUpdate(event.transfer);
    await recordEvent(provider, event);
    return outcome;
  }
  if (event.refund) {
    const outcome = await applyRefundUpdate(provider, event.paymentRef, event.refund);
    await recordEvent(provider, event);
    return outcome;
  }

  const payment = await findPayment(provider, event);
  let outcome: "applied" | "ignored" = "ignored";

  if (payment?.status === "voided" && event.status === "authorized") {
    // Paid after the booking was declined/cancelled — release the late authorisation.
    await releaseDuplicate(payment, event.paymentRef);
    outcome = "applied";
  } else if (payment) {
    const patch: Partial<Payment> = {};
    if (event.paymentRef && !payment.provider_payment_id) patch.provider_payment_id = event.paymentRef;
    if (event.status && TRANSITIONS[payment.status].includes(event.status)) {
      patch.status = event.status;
      const ts = TIMESTAMP[event.status];
      if (ts) patch[ts] = new Date().toISOString();
      patch.last_error = event.status === "failed" ? event.error : null;
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await db.from("payments").update(patch).eq("id", payment.id);
      if (error?.code === "23505") {
        // Another deposit for this booking was authorised first — release this one.
        await releaseDuplicate(payment, event.paymentRef);
      } else if (error) {
        throw error;
      }
      outcome = "applied";
    }
  }

  // A catalogue order's payment moving (e.g. authorised after the supplier
  // already confirmed) may mean capturing and paying out now.
  if (payment?.catalog_order_id && outcome === "applied") await syncOrderSettlement(payment.catalog_order_id);
  // Not only when this event did the authorising: the webhook and the checkout
  // confirmation both report it, and if the first one stopped short of capturing,
  // the second must finish the job. captureInstalment re-reads the payment and
  // does nothing unless it's still only authorised.
  if ((payment?.booking_invoice_id || payment?.purpose === "balance" || payment?.purpose === "request") && event.status === "authorized") await captureInstalment(payment.id);
  // A deposit the provider captured (seen by webhook first): its receipt voucher.
  if (payment?.purpose === "deposit" && payment.booking_id && !payment.booking_invoice_id && outcome === "applied" && event.status === "captured") {
    await issueReceiptVoucher(payment.id).catch((err) => console.error(`receipt voucher for payment ${payment.id} failed`, err));
  }

  // Recorded after applying, so a failed apply is retried by the provider.
  await recordEvent(provider, event);
  return outcome;
}

async function recordEvent(provider: PaymentProvider, event: NormalizedEvent) {
  const { error } = await createAdminClient().from("payment_events").insert({
    provider,
    event_id: event.eventId,
    event_type: event.type,
    payload: event.payload as Json,
  });
  if (error && error.code !== "23505") throw error;
}

/** Voids an authorisation we no longer want (duplicate deposit, or paid after a decline). */
async function releaseDuplicate(payment: Payment, paymentRef: string | null) {
  const ref = paymentRef ?? payment.provider_payment_id;
  const gateway = getGateway(payment.provider);
  if (ref && gateway) await gateway.void(ref).catch((err) => console.error("void duplicate deposit failed", err));
  await createAdminClient()
    .from("payments")
    .update({
      status: "voided",
      voided_at: payment.voided_at ?? new Date().toISOString(),
      provider_payment_id: ref,
      last_error: "Authorisation released: booking already has a deposit or was not confirmed",
    })
    .eq("id", payment.id);
}

// ----------------------------------------------------------------------------
// Settlement (venue confirms → capture, declines/cancels → void)
// ----------------------------------------------------------------------------

/**
 * Captures or releases a booking's authorised deposit. Never throws: a provider
 * failure is recorded on payments.last_error for an admin to retry, so it can't
 * block the venue's decision.
 */
export async function settleDeposit(bookingId: string, action: "capture" | "void"): Promise<void> {
  if (dataSource() !== "supabase") return;
  const db = createAdminClient();
  const { data: payments } = await db
    .from("payments")
    .select("*")
    .eq("booking_id", bookingId)
    .in("status", action === "capture" ? ["authorized"] : ["authorized", "created"]);

  for (const payment of payments ?? []) {
    try {
      if (payment.status === "created") {
        // Never paid — just close it so a late authorisation is voided on arrival.
        await db.from("payments").update({ status: "voided", voided_at: new Date().toISOString() }).eq("id", payment.id);
        continue;
      }
      const gateway = getGateway(payment.provider);
      if (!gateway || !payment.provider_payment_id) throw new Error(`${payment.provider} is not configured or payment ref missing`);

      if (action === "capture") {
        await gateway.capture(payment.provider_payment_id, toPaise(Number(payment.amount_inr)));
        await db
          .from("payments")
          .update({ status: "captured", captured_at: new Date().toISOString(), last_error: null })
          .eq("id", payment.id);
        // The deposit is now an advance received: issue its receipt voucher (the daily sweep retries a failure).
        await issueReceiptVoucher(payment.id).catch((err) => console.error(`receipt voucher for payment ${payment.id} failed`, err));
      } else {
        const released = await gateway.void(payment.provider_payment_id);
        await db
          .from("payments")
          .update({
            status: "voided",
            voided_at: new Date().toISOString(),
            last_error: released ? null : "Authorisation lapses at the provider (auto-refund)",
          })
          .eq("id", payment.id);
      }
    } catch (err) {
      console.error(`Deposit ${action} failed for payment ${payment.id}`, err);
      await db
        .from("payments")
        .update({ last_error: `${action} failed: ${err instanceof Error ? err.message : String(err)}` })
        .eq("id", payment.id);
    }
  }
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

/** Latest deposit per booking, for the client bookings table. */
export async function latestPayments(bookingIds: string[]): Promise<Map<string, Payment>> {
  const out = new Map<string, Payment>();
  if (dataSource() !== "supabase" || bookingIds.length === 0) return out;
  const { data, error } = await createAdminClient()
    .from("payments")
    .select("*")
    .in("booking_id", bookingIds)
    .eq("purpose", "deposit")
    .order("created_at", { ascending: true });
  if (error) throw error;
  for (const p of data) if (p.booking_id) out.set(p.booking_id, p);
  return out;
}

// ----------------------------------------------------------------------------
// Checkout confirmation (the browser's success callback)
// ----------------------------------------------------------------------------

/**
 * Confirms a Razorpay Checkout from the browser's success callback, so the
 * page shows the payment at once instead of waiting for the webhook. The
 * signature proves the callback is genuine for our order; the payment's state
 * is then read from the provider and applied exactly as its webhook would be
 * (same transitions, same idempotency), so whichever arrives first wins and
 * the other is a no-op.
 */
export async function confirmCheckout(member: Member, input: { orderId: string; paymentRef: string; signature: string }): Promise<{ status: PaymentStatus }> {
  if (dataSource() !== "supabase") throw new PaymentError(503, "Payments are not configured.");
  const db = createAdminClient();
  const { data: payment } = await db.from("payments").select("*").eq("provider_order_id", input.orderId).maybeSingle();
  if (!payment) throw new PaymentError(404, "Payment not found.");

  if (member.role !== "ADMIN") {
    const owner = payment.booking_id
      ? (await db.from("bookings").select("company_id").eq("id", payment.booking_id).maybeSingle()).data?.company_id
      : payment.concierge_request_id
        ? (await db.from("concierge_requests").select("company_id").eq("id", payment.concierge_request_id).maybeSingle()).data?.company_id
        : (await db.from("catalog_orders").select("tenant_id").eq("id", payment.catalog_order_id!).maybeSingle()).data?.tenant_id;
    if (!owner || owner !== member.companyId) throw new PaymentError(403, "This payment belongs to another company.");
  }

  const gateway = getGateway(payment.provider);
  if (!gateway) throw new PaymentError(503, "Payments are not configured.");
  // Signed over the order id we stored, not one the browser chose.
  if (gateway.verifyCheckout(payment.provider_order_id, input.paymentRef, input.signature) !== true) {
    throw new PaymentError(400, "We couldn't verify this payment. If money left your account, it will show here shortly.");
  }

  const remote = await gateway.fetchPayment(input.paymentRef);
  if (remote.orderId !== payment.provider_order_id || remote.amountPaise !== toPaise(Number(payment.amount_inr))) {
    throw new PaymentError(400, "This payment doesn't match the order.");
  }
  if (remote.status !== "created") {
    await applyWebhookEvent(payment.provider, {
      eventId: `checkout:${remote.ref}:${remote.status}`,
      type: `checkout.${remote.status}`,
      paymentId: payment.id,
      orderId: payment.provider_order_id,
      paymentRef: remote.ref,
      status: remote.status,
      error: remote.error,
      payload: { source: "checkout", payment: remote.ref, order: payment.provider_order_id, status: remote.status },
    });
  }
  const { data: after } = await db.from("payments").select("status").eq("id", payment.id).maybeSingle();
  return { status: after?.status ?? payment.status };
}

// ----------------------------------------------------------------------------
// Refunds
// ----------------------------------------------------------------------------

/** The booking's captured deposit (the payment a cancellation refunds), or null. */
export async function capturedDeposit(bookingId: string): Promise<Payment | null> {
  if (dataSource() !== "supabase") return null;
  const { data, error } = await createAdminClient().from("payments").select("*").eq("booking_id", bookingId).eq("purpose", "deposit").is("booking_invoice_id", null).eq("status", "captured").maybeSingle();
  if (error) throw error;
  return data;
}

export interface RefundResult {
  refundId: string;
  providerRef: string;
  amountInr: number;
  status: "pending" | "processed";
  /** The refund voucher, when one was issued (no tax invoice yet). */
  voucherNumber: string | null;
}

/**
 * Sends all or part of a captured payment back through its provider. The
 * refund is reserved on the payment first (so two admins can't refund the same
 * money twice), then requested; if the provider refuses, the reservation is
 * undone and the error is thrown. A refunded deposit gets a refund voucher.
 */
export async function refundPayment(paymentId: string, amountInr: number, by: { userId: string | null; reason: string | null }): Promise<RefundResult> {
  if (dataSource() !== "supabase") throw new PaymentError(503, "Payments are not configured.");
  const db = createAdminClient();
  const { data: payment } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
  const refusal = refundRefusal(payment ?? null, amountInr);
  if (refusal || !payment) throw new PaymentError(409, refusal ?? "Payment not found.");
  const gateway = getGateway(payment.provider);
  if (!gateway || !payment.provider_payment_id) throw new PaymentError(503, `${payment.provider} is not configured.`);

  const amount = roundInr(amountInr);
  const next = afterRefund(payment, amount);
  // Reserve: only succeeds if nobody else changed the refunded total meanwhile.
  const { data: reserved, error: reserveError } = await db
    .from("payments")
    .update({ refunded_inr: next.refunded_inr })
    .eq("id", payment.id)
    .eq("status", "captured")
    .eq("refunded_inr", Number(payment.refunded_inr))
    .select("id");
  if (reserveError) throw reserveError;
  if (!reserved?.length) throw new PaymentError(409, "This payment changed just now. Reload and try again.");

  const refundId = crypto.randomUUID();
  const { error: rowError } = await db.from("payment_refunds").insert({ id: refundId, payment_id: payment.id, amount_inr: amount, status: "pending", reason: by.reason, created_by: by.userId });
  if (rowError) {
    await db.from("payments").update({ refunded_inr: Number(payment.refunded_inr) }).eq("id", payment.id);
    throw rowError;
  }

  let sent: { ref: string; status: "pending" | "processed" | "failed" };
  try {
    sent = await gateway.refund({
      paymentRef: payment.provider_payment_id,
      amountPaise: toPaise(amount),
      refundId,
      notes: { payment_id: payment.id, ...(payment.booking_id ? { booking_id: payment.booking_id } : {}) },
    });
    if (sent.status === "failed") throw new Error("the provider declined the refund");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("payment_refunds").update({ status: "failed", error: message.slice(0, 500) }).eq("id", refundId);
    // Give back only this reservation: another refund may have been made meanwhile.
    const { data: now } = await db.from("payments").select("amount_inr, refunded_inr").eq("id", payment.id).maybeSingle();
    await db.from("payments").update({ refunded_inr: afterRefundFailed(now ?? payment, amount).refunded_inr, last_error: `refund failed: ${message}`.slice(0, 500) }).eq("id", payment.id);
    throw new PaymentError(409, `The refund didn't go through: ${message}`);
  }

  const now = new Date().toISOString();
  await db
    .from("payment_refunds")
    .update({ provider_refund_id: sent.ref, status: sent.status, ...(sent.status === "processed" && { processed_at: now }) })
    .eq("id", refundId);
  await db.from("payments").update({ status: next.status, refunded_at: now, last_error: null }).eq("id", payment.id);

  let voucherNumber: string | null = null;
  try {
    const voucher = await issueRefundVoucher(refundId);
    if (voucher.status !== "skipped") voucherNumber = voucher.voucherNumber;
  } catch (err) {
    console.error(`refund voucher for refund ${refundId} failed`, err);
  }
  console.info(JSON.stringify({ audit: "payment_refund", at: now, payment_id: payment.id, refund_id: refundId, provider_refund_id: sent.ref, amount_inr: amount, by: by.userId }));
  return { refundId, providerRef: sent.ref, amountInr: amount, status: sent.status, voucherNumber };
}

/**
 * A refund.* webhook. For a refund made from the app it settles the row
 * (processed, or failed: the money didn't leave, so the payment gets it back).
 * A refund made in the provider's dashboard is unknown here: it's recorded
 * when it's processed, so the payment and its documents stay true.
 */
async function applyRefundUpdate(provider: PaymentProvider, paymentRef: string | null, update: RefundUpdate): Promise<"applied" | "ignored"> {
  const db = createAdminClient();
  const amount = update.amountPaise / 100;
  let row = update.refundId ? (await db.from("payment_refunds").select("*").eq("id", update.refundId).maybeSingle()).data : null;
  row ??= (await db.from("payment_refunds").select("*").eq("provider_refund_id", update.ref).maybeSingle()).data;

  if (row) {
    if (row.status === update.status || row.status === "failed" || (row.status === "processed" && update.status === "pending")) {
      if (!row.provider_refund_id) await db.from("payment_refunds").update({ provider_refund_id: update.ref }).eq("id", row.id);
      return "ignored";
    }
    const now = new Date().toISOString();
    await db
      .from("payment_refunds")
      .update({ provider_refund_id: update.ref, status: update.status, ...(update.status === "processed" && { processed_at: now }), ...(update.status === "failed" && { error: "The provider reported the refund failed." }) })
      .eq("id", row.id);
    if (update.status === "failed") {
      const { data: payment } = await db.from("payments").select("*").eq("id", row.payment_id).maybeSingle();
      if (payment) await db.from("payments").update({ ...afterRefundFailed(payment, Number(row.amount_inr)), last_error: "A refund failed at the provider; nothing was returned." }).eq("id", payment.id);
    }
    return "applied";
  }

  // Unknown refund: made outside the app. Record it once it has been processed.
  if (update.status !== "processed" || !paymentRef) return "ignored";
  const { data: payment } = await db.from("payments").select("*").eq("provider", provider).eq("provider_payment_id", paymentRef).maybeSingle();
  if (!payment || (payment.status !== "captured" && payment.status !== "refunded")) return "ignored";
  const now = new Date().toISOString();
  const { data: inserted, error } = await db
    .from("payment_refunds")
    .insert({ payment_id: payment.id, provider_refund_id: update.ref, amount_inr: amount, status: "processed", reason: "Refunded in the provider's dashboard", processed_at: now })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return "ignored";
  if (error) throw error;
  await db.from("payments").update({ ...afterRefund(payment, amount), refunded_at: now }).eq("id", payment.id);
  if (inserted) await issueRefundVoucher(inserted.id).catch((err) => console.error(`refund voucher for refund ${inserted.id} failed`, err));
  return "applied";
}

/** A booking's refunds, newest first, for the event page. */
export async function listRefunds(bookingId: string): Promise<{ id: string; amount_inr: number; status: string; created_at: string }[]> {
  if (dataSource() !== "supabase") return [];
  const db = createAdminClient();
  const { data: payments } = await db.from("payments").select("id").eq("booking_id", bookingId);
  if (!payments?.length) return [];
  const { data, error } = await db.from("payment_refunds").select("id, amount_inr, status, created_at").in("payment_id", payments.map((p) => p.id)).neq("status", "failed").order("created_at", { ascending: false });
  if (error?.code === "42P01" || error?.code === "PGRST205") return [];
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, amount_inr: Number(r.amount_inr) }));
}

/** Captured payments for these concierge requests, by request id (Home → Requests, the receipt). */
export async function requestPayments(requestIds: string[]): Promise<Map<string, Payment>> {
  const out = new Map<string, Payment>();
  if (dataSource() !== "supabase" || requestIds.length === 0) return out;
  const { data, error } = await createAdminClient().from("payments").select("*").in("concierge_request_id", requestIds).eq("status", "captured");
  // Before migration 20261119000000 the column doesn't exist: nothing is paid.
  if (error?.code === "42703" || error?.code === "PGRST204") return out;
  if (error) throw error;
  for (const p of data ?? []) if (p.concierge_request_id) out.set(p.concierge_request_id, p);
  return out;
}
