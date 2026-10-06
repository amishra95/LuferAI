import "server-only";

import type { Member } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { calculateGst, roundInr, splitCommission, type TaxInvoicePayload } from "@/lib/gst-engine";
import { DEPOSIT_RATE, depositFor } from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Payment, PaymentProvider, PaymentStatus } from "@/lib/supabase/database.types";
import { getCheckoutGateway, getGateway, type DepositCheckout, type NormalizedEvent } from "./gateways";

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
    company_gstin: booking.company!.gstin,
    venue_gstin: booking.venue!.gstin,
    booking_id: booking.id,
    invoice_date: booking.event_date,
  });
  const deposit = depositFor(gst.invoice_total);
  const invoice: DepositInvoice = {
    ...gst,
    list_amount: list,
    rate_card_id: booking.rate_card_id,
    rate_card_savings: roundInr(Math.max(0, list - taxable)),
    deposit_rate: DEPOSIT_RATE,
    deposit_amount: deposit,
    balance_due: splitCommission(gst.invoice_total, DEPOSIT_RATE).venue_payout,
  };

  const paymentId = crypto.randomUUID();
  const checkout = await gateway.createDepositCheckout({
    paymentId,
    bookingId,
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
    provider: gateway.name,
    amount_inr: deposit,
    deposit_rate: DEPOSIT_RATE,
    provider_order_id: checkout.orderId,
    invoice: invoice as unknown as Json,
  });
  if (error) throw error;

  return { checkout, invoice };
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

  // Recorded after applying, so a failed apply is retried by the provider.
  const { error } = await db.from("payment_events").insert({
    provider,
    event_id: event.eventId,
    event_type: event.type,
    payload: event.payload as Json,
  });
  if (error && error.code !== "23505") throw error;
  return outcome;
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

/** Latest payment per booking, for the client bookings table. */
export async function latestPayments(bookingIds: string[]): Promise<Map<string, Payment>> {
  const out = new Map<string, Payment>();
  if (dataSource() !== "supabase" || bookingIds.length === 0) return out;
  const { data, error } = await createAdminClient()
    .from("payments")
    .select("*")
    .in("booking_id", bookingIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  for (const p of data) out.set(p.booking_id, p);
  return out;
}
