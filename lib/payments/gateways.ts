import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";

import type { TaxInvoicePayload } from "@/lib/gst-engine";
import type { PaymentProvider } from "@/lib/supabase/database.types";

/**
 * Payment provider adapter. Both providers authorise a deposit at checkout and
 * capture it later (manual capture), so a venue decline never charges the client.
 *
 *   PAYMENT_PROVIDER=razorpay|stripe  picks the provider for new checkouts; when
 *   unset, the first provider with keys configured wins (Razorpay first).
 *
 * Existing payments always settle through the provider that created them.
 */

export interface DepositCheckoutInput {
  paymentId: string;
  bookingId: string;
  amountPaise: number;
  description: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  /** B2B tax details for the deposit, carried to the provider for reconciliation. */
  billing: {
    customerLegalName: string;
    invoice: TaxInvoicePayload;
    depositInr: number;
  };
}

export type DepositCheckout =
  /** Open Razorpay Checkout.js in the browser with this order. */
  | {
      provider: "razorpay";
      orderId: string;
      keyId: string;
      amountPaise: number;
      currency: "INR";
      /** Server-built Checkout options; the browser passes them through unchanged. */
      notes: RazorpayNotes;
      prefill: { name: string; email?: string };
      config: typeof RAZORPAY_CHECKOUT_CONFIG;
    }
  /** Redirect the browser to a hosted Stripe Checkout page. */
  | { provider: "stripe"; orderId: string; url: string };

export type NormalizedStatus = "authorized" | "captured" | "voided" | "failed" | "refunded";

export interface NormalizedEvent {
  eventId: string;
  type: string;
  /** Our payments.id when the provider echoes it back (metadata/notes). */
  paymentId: string | null;
  orderId: string | null;
  /** Razorpay pay_… / Stripe pi_… */
  paymentRef: string | null;
  status: NormalizedStatus | null;
  error: string | null;
  payload: unknown;
}

export class WebhookSignatureError extends Error {}

export interface PaymentGateway {
  name: PaymentProvider;
  createDepositCheckout(input: DepositCheckoutInput): Promise<DepositCheckout>;
  capture(paymentRef: string, amountPaise: number): Promise<void>;
  /** Releases an authorisation. Returns false when the provider can only let it lapse. */
  void(paymentRef: string): Promise<boolean>;
  /** Verifies the signature (throws WebhookSignatureError) and normalises the event. */
  parseWebhook(rawBody: string, headers: Headers): NormalizedEvent;
}

// ----------------------------------------------------------------------------
// Razorpay (REST: Orders API + manual capture)
// ----------------------------------------------------------------------------

/** Minutes an authorisation stays capturable before Razorpay auto-refunds it (max 7200 = 5 days). */
const RAZORPAY_MANUAL_EXPIRY_MINUTES = 7200;

/**
 * Checkout display config: UPI first with all three flows — dynamic QR (shown on
 * desktop), intent (UPI apps on mobile) and collect (pay to a UPI ID) — then cards
 * and netbanking. Other methods (wallets, EMI, pay later) are hidden.
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/configure-payment-methods/
 */
export const RAZORPAY_CHECKOUT_CONFIG = {
  display: {
    blocks: {
      upi: {
        name: "Pay with UPI",
        instruments: [{ method: "upi", flows: ["qr", "intent", "collect"] }],
      },
      bank: {
        name: "Cards & netbanking",
        instruments: [{ method: "card" }, { method: "netbanking" }],
      },
    },
    sequence: ["block.upi", "block.bank"],
    preferences: { show_default_blocks: false },
  },
} as const;

/** Razorpay notes: at most 15 string pairs of ≤256 chars each. */
export type RazorpayNotes = Record<string, string>;
const MAX_NOTES = 15;
const MAX_NOTE_LENGTH = 256;

const rupees = (n: number) => n.toFixed(2);

/**
 * B2B tax metadata for a deposit, set on both the order and the Checkout options.
 * Checkout notes are stored on the payment entity, so every payment.* webhook —
 * UPI included — carries the corporate GSTIN, place of supply and tax split.
 */
export function razorpayNotes(input: DepositCheckoutInput): RazorpayNotes {
  const { invoice, customerLegalName, depositInr } = input.billing;
  const { cgst, sgst, igst } = invoice.tax_breakup;
  const notes: RazorpayNotes = {
    payment_id: input.paymentId,
    booking_id: input.bookingId,
    purpose: "event_deposit",
    customer_legal_name: customerLegalName,
    customer_gstin: invoice.recipient.gstin,
    place_of_supply: `${invoice.place_of_supply.state_code}-${invoice.place_of_supply.state_name}`,
    supplier_gstin: invoice.supplier.gstin,
    supply_type: invoice.supply_type === "INTRA_STATE" ? "intrastate" : "interstate",
    sac: invoice.sac.code,
    taxable_value_inr: rupees(invoice.taxable_value),
    gst_breakup_inr:
      invoice.gst_type === "IGST" ? `IGST ${rupees(igst.amount)}` : `CGST ${rupees(cgst.amount)} + SGST ${rupees(sgst.amount)}`,
    invoice_total_inr: rupees(invoice.invoice_total),
    deposit_inr: rupees(depositInr),
    ...(input.customerEmail ? { billing_email: input.customerEmail } : {}),
  };

  const entries = Object.entries(notes);
  if (entries.length > MAX_NOTES) throw new Error(`Razorpay allows ${MAX_NOTES} notes, got ${entries.length}`);
  return Object.fromEntries(entries.map(([k, v]) => [k, v.slice(0, MAX_NOTE_LENGTH)]));
}

function razorpayGateway(keyId: string, keySecret: string): PaymentGateway {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  async function api<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Razorpay ${path} failed: ${json?.error?.description ?? res.status}`);
    }
    return json as T;
  }

  return {
    name: "razorpay",

    async createDepositCheckout(input) {
      const notes = razorpayNotes(input);
      const order = await api<{ id: string }>("/orders", {
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.paymentId,
        notes,
        payment: {
          capture: "manual",
          capture_options: { manual_expiry_period: RAZORPAY_MANUAL_EXPIRY_MINUTES, refund_speed: "optimum" },
        },
      });
      return {
        provider: "razorpay",
        orderId: order.id,
        keyId,
        amountPaise: input.amountPaise,
        currency: "INR",
        notes,
        prefill: { name: input.billing.customerLegalName, ...(input.customerEmail ? { email: input.customerEmail } : {}) },
        config: RAZORPAY_CHECKOUT_CONFIG,
      };
    },

    async capture(paymentRef, amountPaise) {
      await api(`/payments/${encodeURIComponent(paymentRef)}/capture`, { amount: amountPaise, currency: "INR" });
    },

    async void() {
      // Razorpay has no void API: uncaptured authorisations are auto-refunded after
      // manual_expiry_period. The payment is marked voided on our side.
      return false;
    },

    parseWebhook(rawBody, headers) {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const signature = headers.get("x-razorpay-signature") ?? "";
      if (!secret) throw new WebhookSignatureError("RAZORPAY_WEBHOOK_SECRET is not set");
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookSignatureError("Bad Razorpay signature");

      const event = JSON.parse(rawBody) as {
        event: string;
        payload?: { payment?: { entity?: { id: string; order_id: string | null; notes?: Record<string, string>; error_description?: string | null } } };
      };
      const payment = event.payload?.payment?.entity;
      const status: Record<string, NormalizedStatus> = {
        "payment.authorized": "authorized",
        "payment.captured": "captured",
        "payment.failed": "failed",
      };
      return {
        eventId: headers.get("x-razorpay-event-id") ?? `${event.event}:${payment?.id ?? "unknown"}`,
        type: event.event,
        paymentId: payment?.notes?.payment_id ?? null,
        orderId: payment?.order_id ?? null,
        paymentRef: payment?.id ?? null,
        status: status[event.event] ?? null,
        error: payment?.error_description ?? null,
        payload: event,
      };
    },
  };
}

// ----------------------------------------------------------------------------
// Stripe (hosted Checkout + manual-capture PaymentIntent)
// ----------------------------------------------------------------------------

function stripeGateway(secretKey: string): PaymentGateway {
  const stripe = new Stripe(secretKey);

  return {
    name: "stripe",

    async createDepositCheckout(input) {
      const metadata = { payment_id: input.paymentId, booking_id: input.bookingId };
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: input.paymentId,
        customer_email: input.customerEmail ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: { currency: "inr", unit_amount: input.amountPaise, product_data: { name: input.description } },
          },
        ],
        payment_intent_data: { capture_method: "manual", metadata },
        metadata,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error("Stripe did not return a Checkout URL");
      return { provider: "stripe", orderId: session.id, url: session.url };
    },

    async capture(paymentRef, amountPaise) {
      await stripe.paymentIntents.capture(paymentRef, { amount_to_capture: amountPaise });
    },

    async void(paymentRef) {
      await stripe.paymentIntents.cancel(paymentRef);
      return true;
    },

    parseWebhook(rawBody, headers) {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new WebhookSignatureError("STRIPE_WEBHOOK_SECRET is not set");
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, headers.get("stripe-signature") ?? "", secret);
      } catch (err) {
        throw new WebhookSignatureError(err instanceof Error ? err.message : "Bad Stripe signature");
      }

      const base = { eventId: event.id, type: event.type, payload: event, error: null as string | null };
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.expired": {
          const s = event.data.object;
          return {
            ...base,
            paymentId: s.metadata?.payment_id ?? null,
            orderId: s.id,
            paymentRef: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
            // A completed manual-capture session is authorised; amount_capturable_updated confirms it.
            status: event.type === "checkout.session.expired" ? "failed" : null,
          };
        }
        case "payment_intent.amount_capturable_updated":
        case "payment_intent.succeeded":
        case "payment_intent.canceled":
        case "payment_intent.payment_failed": {
          const pi = event.data.object;
          const status: Record<string, NormalizedStatus> = {
            "payment_intent.amount_capturable_updated": "authorized",
            "payment_intent.succeeded": "captured",
            "payment_intent.canceled": "voided",
            "payment_intent.payment_failed": "failed",
          };
          return {
            ...base,
            paymentId: pi.metadata?.payment_id ?? null,
            orderId: null,
            paymentRef: pi.id,
            status: status[event.type],
            error: pi.last_payment_error?.message ?? null,
          };
        }
        case "charge.refunded": {
          const charge = event.data.object;
          return {
            ...base,
            paymentId: null,
            orderId: null,
            paymentRef: typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null,
            status: charge.refunded ? "refunded" : null,
          };
        }
        default:
          return { ...base, paymentId: null, orderId: null, paymentRef: null, status: null };
      }
    },
  };
}

// ----------------------------------------------------------------------------
// Selection
// ----------------------------------------------------------------------------

export function getGateway(provider: PaymentProvider): PaymentGateway | null {
  if (provider === "razorpay") {
    const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = process.env;
    return id && secret ? razorpayGateway(id, secret) : null;
  }
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? stripeGateway(key) : null;
}

/** The provider used for new checkouts, or null when none is configured. */
export function getCheckoutGateway(): PaymentGateway | null {
  const preferred = process.env.PAYMENT_PROVIDER;
  if (preferred === "razorpay" || preferred === "stripe") return getGateway(preferred);
  return getGateway("razorpay") ?? getGateway("stripe");
}

/** Which provider sent this webhook, from its signature header. */
export function detectWebhookProvider(headers: Headers): PaymentProvider | null {
  if (headers.get("x-razorpay-signature")) return "razorpay";
  if (headers.get("stripe-signature")) return "stripe";
  return null;
}
