import "server-only";

import type { Member } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { todayInIndia, validateGstin, type TaxInvoicePayload } from "@/lib/gst-engine";
import { getGateway, getRouteGateway, type DepositCheckout, type TransferUpdate } from "@/lib/payments/gateways";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Payment, TcsEntry, VendorPayout } from "@/lib/supabase/database.types";
import { computeSettlement, planSettlement, reconcileOrder, returnPeriod, type PaymentState, type PayoutState, type ReconciliationStage } from "./settlement";

/**
 * Catalogue-order payments and partner payouts over Razorpay Route
 * (migration 0023; maths and step planning in ./settlement.ts).
 *
 *   buyer pays (manual capture) → supplier confirms → capture + held transfer
 *   → delivered → hold released → Razorpay settles to the partner
 *   cancelled → authorisation released, or refund with the transfer reversed
 *
 * syncOrderSettlement() is the one entry point after any order change or
 * payment/transfer webhook. It never throws: provider failures are recorded
 * on the payment or payout row (last_error) for an admin to retry, so they
 * can't block a supplier's or buyer's action. Supabase only, like deposits.
 *
 * Configuration: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (Route enabled on the
 * account), RAZORPAY_WEBHOOK_SECRET, and PLATFORM_GSTIN (the platform's own
 * registration: it invoices commission and collects TCS).
 */

const toPaise = (inr: number) => Math.round(Number((inr * 100).toPrecision(15)));

export class MarketplaceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    message: string
  ) {
    super(message);
    this.name = "MarketplaceError";
  }
}

export function platformGstin(): string | null {
  const g = process.env.PLATFORM_GSTIN?.trim().toUpperCase();
  return g && validateGstin(g).valid ? g : null;
}

/** Order payments need Supabase, Razorpay with Route, and the platform's GSTIN. */
export const orderPaymentsEnabled = () => dataSource() === "supabase" && getGateway("razorpay") !== null && platformGstin() !== null;

// ----------------------------------------------------------------------------
// Checkout
// ----------------------------------------------------------------------------

const PAYABLE = new Set(["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"]);

/** Starts Razorpay Checkout for a catalogue order's invoice total (authorised now, captured when the supplier confirms). */
export async function createOrderCheckout(orderId: string, member: Member, origin: string): Promise<{ checkout: DepositCheckout; amountInr: number }> {
  const gateway = getGateway("razorpay");
  if (!orderPaymentsEnabled() || !gateway) throw new MarketplaceError(503, "Order payments are not configured.");
  const db = createAdminClient();
  const { data: order } = await db
    .from("catalog_orders")
    .select("*, item:catalog_items(name), company:companies(legal_name, primary_contact_email)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new MarketplaceError(404, "Order not found.");
  if (member.role !== "ADMIN" && order.tenant_id !== member.companyId) throw new MarketplaceError(403, "This order belongs to another company.");
  if (!PAYABLE.has(order.status)) throw new MarketplaceError(409, order.status === "PENDING_APPROVAL" ? "This order is still awaiting sign-off." : `A ${order.status.toLowerCase()} order can't be paid.`);

  const { data: live } = await db.from("payments").select("id").eq("catalog_order_id", orderId).in("status", ["authorized", "captured"]).maybeSingle();
  if (live) throw new MarketplaceError(409, "This order is already paid.");

  const invoice = order.invoice as unknown as TaxInvoicePayload;
  const paymentId = crypto.randomUUID();
  const checkout = await gateway.createDepositCheckout({
    paymentId,
    subject: { kind: "order", id: orderId },
    amountPaise: toPaise(invoice.invoice_total),
    description: `${order.quantity} × ${order.item?.name ?? "catalogue item"}`,
    customerEmail: member.email ?? order.company?.primary_contact_email ?? null,
    successUrl: `${origin}/client?tab=catalog&paid=1`,
    cancelUrl: `${origin}/client?tab=catalog`,
    billing: { customerLegalName: order.company?.legal_name ?? "", invoice, depositInr: invoice.invoice_total },
  });
  const { error } = await db.from("payments").insert({
    id: paymentId,
    catalog_order_id: orderId,
    provider: "razorpay",
    amount_inr: invoice.invoice_total,
    deposit_rate: 1,
    provider_order_id: checkout.orderId,
    invoice: invoice as unknown as Json,
  });
  if (error) throw error;
  return { checkout, amountInr: invoice.invoice_total };
}

// ----------------------------------------------------------------------------
// Settlement
// ----------------------------------------------------------------------------

/** The payment that matters for an order: the live one, else the most recent. */
function pickPayment(payments: Payment[]): Payment | null {
  return payments.find((p) => p.status === "captured" || p.status === "authorized") ?? payments.find((p) => p.status === "refunded") ?? payments[payments.length - 1] ?? null;
}

/**
 * Brings an order's money in line with its status (planSettlement). Safe to
 * call repeatedly and concurrently: each step claims its row first.
 */
export async function syncOrderSettlement(orderId: string): Promise<void> {
  if (dataSource() !== "supabase") return;
  const db = createAdminClient();
  try {
    const [{ data: order }, { data: payments }, { data: payout }] = await Promise.all([
      db.from("catalog_orders").select("*, partner:partners(gstin, razorpay_account_id, commission_rate)").eq("id", orderId).maybeSingle(),
      db.from("payments").select("*").eq("catalog_order_id", orderId).order("created_at"),
      db.from("vendor_payouts").select("*").eq("catalog_order_id", orderId).maybeSingle(),
    ]);
    if (!order) return;
    const payment = pickPayment(payments ?? []);
    const steps = planSettlement({
      orderStatus: order.status,
      payment: (payment?.status ?? null) as PaymentState | null,
      payout: (payout?.status ?? null) as PayoutState | null,
      linkedAccount: Boolean(order.partner?.razorpay_account_id),
    });
    for (const step of steps) {
      const ok = await applyStep(step, { order, payment: payment!, payoutId: payout?.id ?? null });
      if (!ok) break;
    }
  } catch (err) {
    console.error(`settlement: sync failed for order ${orderId}`, err);
  }
}

type OrderRow = { id: string; partner_id: string; status: string; invoice: Json; commission_rate: number | null; partner: { gstin: string | null; razorpay_account_id: string | null; commission_rate: number } | null };

/** Applies one step; false stops the rest (it failed, or someone else is doing it). */
async function applyStep(step: string, ctx: { order: OrderRow; payment: Payment; payoutId: string | null }): Promise<boolean> {
  const db = createAdminClient();
  const { order, payment } = ctx;
  const gateway = getGateway("razorpay");
  const route = getRouteGateway();
  const fail = async (table: "payments" | "vendor_payouts", id: string, message: string) => {
    console.error(`settlement: ${step} failed for order ${order.id}: ${message}`);
    await db.from(table).update({ last_error: `${step} failed: ${message}`.slice(0, 500) }).eq("id", id);
    return false;
  };
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  switch (step) {
    case "capture": {
      if (!gateway || !payment.provider_payment_id) return fail("payments", payment.id, "Razorpay isn't configured or the payment reference is missing");
      try {
        await gateway.capture(payment.provider_payment_id, toPaise(Number(payment.amount_inr)));
      } catch (err) {
        return fail("payments", payment.id, message(err));
      }
      await db.from("payments").update({ status: "captured", captured_at: new Date().toISOString(), last_error: null }).eq("id", payment.id).eq("status", "authorized");
      payment.status = "captured";
      return true;
    }

    case "transfer": {
      const gstin = platformGstin();
      const account = order.partner?.razorpay_account_id;
      const supplierGstin = order.partner?.gstin;
      if (!route || !gstin || !account || !supplierGstin || !payment.provider_payment_id) return false;
      const invoice = order.invoice as unknown as TaxInvoicePayload;
      const today = todayInIndia();
      const s = computeSettlement({ invoice, commissionRate: Number(order.commission_rate ?? order.partner?.commission_rate ?? 0), platformGstin: gstin, date: today });
      const fields = {
        partner_id: order.partner_id,
        payment_id: payment.id,
        linked_account_id: account,
        gross_inr: s.gross,
        taxable_inr: s.taxable,
        commission_rate: s.commissionRate,
        commission_inr: s.commission,
        commission_gst_inr: s.commissionGst,
        tcs_rate_bps: s.tcs.rateBps,
        tcs_inr: s.tcs.total,
        net_payout_inr: s.net,
        status: "pending",
        last_error: null,
      };
      // Claim: a new row, or a failed one back to pending. A conflict means another sync has it.
      const claim = ctx.payoutId
        ? await db.from("vendor_payouts").update(fields).eq("id", ctx.payoutId).eq("status", "failed").select("id").maybeSingle()
        : await db.from("vendor_payouts").insert({ catalog_order_id: order.id, ...fields }).select("id").maybeSingle();
      if (claim.error?.code === "23505") return false;
      if (claim.error) throw claim.error;
      if (!claim.data) return false;
      const payoutId = claim.data.id;

      let transferRef: string;
      try {
        transferRef = await route.transfer({
          paymentRef: payment.provider_payment_id,
          account,
          amountPaise: toPaise(s.net),
          onHold: true,
          notes: { catalog_order_id: order.id, gross_inr: s.gross.toFixed(2), commission_inr: s.commission.toFixed(2), tcs_inr: s.tcs.total.toFixed(2) },
        });
      } catch (err) {
        await db.from("vendor_payouts").update({ status: "failed" }).eq("id", payoutId);
        return fail("vendor_payouts", payoutId, message(err));
      }
      await db.from("vendor_payouts").update({ status: "on_hold", provider_transfer_id: transferRef }).eq("id", payoutId);
      // GSTR-8: TCS is collected when the platform collects (the capture month).
      const { error } = await db.from("tcs_entries").insert({
        catalog_order_id: order.id,
        partner_id: order.partner_id,
        supplier_gstin: supplierGstin,
        place_of_supply: invoice.place_of_supply.state_code,
        return_period: returnPeriod(new Date()),
        kind: "collection",
        taxable_inr: s.taxable,
        rate_bps: s.tcs.rateBps,
        cgst_inr: s.tcs.cgst,
        sgst_inr: s.tcs.sgst,
        igst_inr: s.tcs.igst,
      });
      if (error && error.code !== "23505") throw error;
      ctx.payoutId = payoutId;
      return true;
    }

    case "release": {
      const { data: claimed } = await db
        .from("vendor_payouts")
        .update({ status: "released", released_at: new Date().toISOString(), last_error: null })
        .eq("catalog_order_id", order.id)
        .eq("status", "on_hold")
        .select("id, provider_transfer_id")
        .maybeSingle();
      if (!claimed) return false;
      try {
        if (!route || !claimed.provider_transfer_id) throw new Error("Route isn't configured or the transfer reference is missing");
        await route.release(claimed.provider_transfer_id);
      } catch (err) {
        await db.from("vendor_payouts").update({ status: "on_hold", released_at: null }).eq("id", claimed.id);
        return fail("vendor_payouts", claimed.id, message(err));
      }
      return true;
    }

    case "void": {
      if (payment.status === "authorized" && gateway && payment.provider_payment_id) {
        const released = await gateway.void(payment.provider_payment_id).catch(() => false);
        await db.from("payments").update({ status: "voided", voided_at: new Date().toISOString(), last_error: released ? null : "Authorisation lapses at the provider (auto-refund)" }).eq("id", payment.id);
      } else {
        await db.from("payments").update({ status: "voided", voided_at: new Date().toISOString() }).eq("id", payment.id);
      }
      return true;
    }

    case "refund": {
      if (!route || !payment.provider_payment_id) return fail("payments", payment.id, "Route isn't configured or the payment reference is missing");
      try {
        await route.refundAndReverse(payment.provider_payment_id, toPaise(Number(payment.amount_inr)));
      } catch (err) {
        return fail("payments", payment.id, message(err));
      }
      const now = new Date().toISOString();
      await db.from("payments").update({ status: "refunded", last_error: null }).eq("id", payment.id);
      await db.from("vendor_payouts").update({ status: "reversed", reversed_at: now }).eq("catalog_order_id", order.id).neq("status", "reversed");
      await recordTcsReversal(order.id);
      return true;
    }
  }
  return false;
}

/** A return (cancellation after collection) is reported negative in the month it happens. */
async function recordTcsReversal(orderId: string) {
  const db = createAdminClient();
  const { data: c } = await db.from("tcs_entries").select("*").eq("catalog_order_id", orderId).eq("kind", "collection").maybeSingle();
  if (!c) return;
  const neg = (n: number) => (Number(n) === 0 ? 0 : -Number(n));
  const { error } = await db.from("tcs_entries").insert({
    catalog_order_id: orderId,
    partner_id: c.partner_id,
    supplier_gstin: c.supplier_gstin,
    place_of_supply: c.place_of_supply,
    return_period: returnPeriod(new Date()),
    kind: "reversal",
    taxable_inr: neg(c.taxable_inr),
    rate_bps: c.rate_bps,
    cgst_inr: neg(c.cgst_inr),
    sgst_inr: neg(c.sgst_inr),
    igst_inr: neg(c.igst_inr),
  });
  if (error && error.code !== "23505") throw error;
}

/** transfer.* webhook. Moves only forward (a late "processed" never un-settles a payout). */
export async function applyTransferUpdate(update: TransferUpdate): Promise<"applied" | "ignored"> {
  if (!update.status) return "ignored";
  const db = createAdminClient();
  const { data: payout } = await db.from("vendor_payouts").select("id, status").eq("provider_transfer_id", update.ref).maybeSingle();
  if (!payout) return "ignored";
  const rank: Record<string, number> = { pending: 0, on_hold: 1, failed: 1, released: 2, settled: 3, reversed: 4 };
  if (rank[update.status] <= rank[payout.status]) return "ignored";
  const now = new Date().toISOString();
  const { error } = await db
    .from("vendor_payouts")
    .update({
      status: update.status,
      ...(update.status === "released" && { released_at: now }),
      ...(update.status === "settled" && { settled_at: now }),
      ...(update.status === "reversed" && { reversed_at: now }),
      last_error: update.status === "failed" ? (update.error ?? "Transfer failed") : null,
    })
    .eq("id", payout.id);
  if (error) throw error;
  return "applied";
}

// ----------------------------------------------------------------------------
// Linked accounts
// ----------------------------------------------------------------------------

/**
 * Connects a partner's Razorpay Route linked account (created and KYC'd in the
 * Razorpay dashboard). Checks it's activated, then settles any orders that were
 * paid while the partner had no account.
 */
export async function setLinkedAccount(partnerId: string, accountId: string | null): Promise<{ status: string | null }> {
  const value = accountId?.trim() || null;
  if (value && !/^acc_[A-Za-z0-9]{14}$/.test(value)) throw new MarketplaceError(400, "A Razorpay linked account id looks like acc_ followed by 14 letters and digits.");
  let status: string | null = null;
  if (value) {
    const route = getRouteGateway();
    if (!route) throw new MarketplaceError(503, "Razorpay isn't configured.");
    try {
      status = await route.accountStatus(value);
    } catch (err) {
      throw new MarketplaceError(400, `Razorpay couldn't find that account: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (status !== "activated") throw new MarketplaceError(409, `That linked account is ${status}. Payouts start once Razorpay activates it.`);
  }
  const db = createAdminClient();
  const { error } = await db.from("partners").update({ razorpay_account_id: value }).eq("id", partnerId);
  if (error?.code === "23505") throw new MarketplaceError(409, "That linked account is already connected to another partner.");
  if (error) throw error;
  if (value) {
    const { data: paid } = await db.from("catalog_orders").select("id, payments!inner(status)").eq("partner_id", partnerId).eq("payments.status", "captured");
    for (const o of paid ?? []) await syncOrderSettlement(o.id);
  }
  return { status };
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export interface OrderSettlement {
  payment: Pick<Payment, "id" | "status" | "amount_inr" | "last_error"> | null;
  payout: VendorPayout | null;
  stage: ReconciliationStage;
  issues: string[];
}

/**
 * Payment, payout and PO reconciliation per order, for the client's orders,
 * the partner's queue and payouts tab. Empty outside Supabase.
 */
export async function listOrderSettlements(orders: { id: string; status: string; total_amount_inr: number; invoice: unknown }[]): Promise<Map<string, OrderSettlement>> {
  const out = new Map<string, OrderSettlement>();
  if (dataSource() !== "supabase" || orders.length === 0) return out;
  const ids = orders.map((o) => o.id);
  const db = createAdminClient();
  const [payments, payouts, allocations] = await Promise.all([
    db.from("payments").select("id, status, amount_inr, last_error, catalog_order_id, created_at").in("catalog_order_id", ids).order("created_at"),
    db.from("vendor_payouts").select("*").in("catalog_order_id", ids),
    db.from("po_allocations").select("catalog_order_id, amount_inr, status").in("catalog_order_id", ids),
  ]);
  for (const r of [payments, payouts, allocations]) if (r.error) throw r.error;
  for (const o of orders) {
    const payment = pickPayment((payments.data ?? []).filter((p) => p.catalog_order_id === o.id) as Payment[]);
    const payout = (payouts.data ?? []).find((p) => p.catalog_order_id === o.id) ?? null;
    const allocation = (allocations.data ?? []).find((a) => a.catalog_order_id === o.id) ?? null;
    const invoiceTotal = Number((o.invoice as TaxInvoicePayload | null)?.invoice_total ?? 0);
    const r = reconcileOrder({
      order: { status: o.status, taxable: Number(o.total_amount_inr), invoiceTotal },
      allocation: allocation && { amount: Number(allocation.amount_inr), status: allocation.status },
      payment: payment && { amount: Number(payment.amount_inr), status: payment.status as PaymentState },
      payout: payout && { gross: Number(payout.gross_inr), status: payout.status as PayoutState },
    });
    out.set(o.id, { payment: payment && { id: payment.id, status: payment.status, amount_inr: Number(payment.amount_inr), last_error: payment.last_error }, payout, ...r });
  }
  return out;
}

/** A partner's TCS entries, newest period first (what they reconcile against GSTR-2X). */
export async function listPartnerTcs(partnerId: string): Promise<TcsEntry[]> {
  if (dataSource() !== "supabase") return [];
  const { data, error } = await createAdminClient().from("tcs_entries").select("*").eq("partner_id", partnerId).order("return_period", { ascending: false }).order("created_at");
  if (error) throw error;
  return data;
}

/** GSTR-8 rows for one return period (admin export). */
export async function gstr8Summary(period: string) {
  if (dataSource() !== "supabase") return [];
  const { data, error } = await createAdminClient().from("tcs_gstr8_summary").select("*").eq("return_period", period).order("supplier_gstin");
  if (error) throw error;
  return data;
}
