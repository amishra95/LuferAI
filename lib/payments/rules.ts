/**
 * Payment rules that need no database or provider: Razorpay signatures,
 * how much of a payment can go back, what is left on an invoice.
 * Pure (no path aliases): tests import it directly (tests/payments.test.mjs).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const sameHex = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Razorpay webhook: X-Razorpay-Signature is HMAC-SHA256 of the raw body with the webhook secret. */
export function validWebhookSignature(rawBody: string, signature: string, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  return sameHex(signature, createHmac("sha256", webhookSecret).update(rawBody).digest("hex"));
}

/**
 * Razorpay Checkout success: razorpay_signature is HMAC-SHA256 of
 * "<order_id>|<payment_id>" with the API key secret. The order id must be the
 * one we created, never the one the browser sends back.
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/#15-verify-payment-signature
 */
export function validCheckoutSignature(orderId: string, paymentRef: string, signature: string, keySecret: string): boolean {
  if (!orderId || !paymentRef || !signature || !keySecret) return false;
  return sameHex(signature, createHmac("sha256", keySecret).update(`${orderId}|${paymentRef}`).digest("hex"));
}

export type PaymentPurpose = "deposit" | "balance" | "instalment" | "order";

const paise = (inr: number) => Math.round(Number((inr * 100).toPrecision(15)));
const rupees = (p: number) => p / 100;

/** What can still be refunded on a payment (0 unless it was captured). */
export function refundable(payment: { status: string; amount_inr: number; refunded_inr?: number | null }): number {
  if (payment.status !== "captured") return 0;
  return rupees(Math.max(0, paise(Number(payment.amount_inr)) - paise(Number(payment.refunded_inr ?? 0))));
}

/** Why a refund of `amount` can't be made, in words for the admin (null: it can). */
export function refundRefusal(payment: { status: string; amount_inr: number; refunded_inr?: number | null } | null, amount: number): string | null {
  if (!payment) return "There is no captured payment to refund.";
  if (payment.status === "refunded") return "This payment was already refunded in full.";
  if (payment.status !== "captured") return `Only a captured payment can be refunded (this one is ${payment.status}).`;
  if (!Number.isFinite(amount) || amount <= 0) return "Enter a refund amount above zero.";
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return "Refunds go to the paisa: two decimal places at most.";
  const left = refundable(payment);
  if (paise(amount) > paise(left)) return `At most ₹${left.toLocaleString("en-IN", { minimumFractionDigits: 2 })} can be refunded on this payment.`;
  return null;
}

/** A payment's refunded total and status after `amount` more goes back. */
export function afterRefund(payment: { amount_inr: number; refunded_inr?: number | null }, amount: number): { refunded_inr: number; status: "captured" | "refunded" } {
  const total = Math.min(paise(Number(payment.amount_inr)), paise(Number(payment.refunded_inr ?? 0)) + paise(amount));
  return { refunded_inr: rupees(total), status: total >= paise(Number(payment.amount_inr)) ? "refunded" : "captured" };
}

/** A payment's refunded total and status after a refund of `amount` failed at the provider. */
export function afterRefundFailed(payment: { amount_inr: number; refunded_inr?: number | null }, amount: number): { refunded_inr: number; status: "captured" } {
  return { refunded_inr: rupees(Math.max(0, paise(Number(payment.refunded_inr ?? 0)) - paise(amount))), status: "captured" };
}

/**
 * What's still to pay on an issued invoice: its total, less the advance set
 * against it when it was issued, less balance payments captured since.
 */
export function invoiceOutstanding(invoiceTotal: number, advance: number, balancePaid: number): number {
  return rupees(Math.max(0, paise(invoiceTotal) - paise(advance) - paise(balancePaid)));
}

/** The deposit a company would get back on cancelling: the venue's refund share of the booking, capped at what was actually paid. */
export function suggestedRefund(refundPct: number, payment: { status: string; amount_inr: number; refunded_inr?: number | null } | null): number {
  if (!payment) return 0;
  const left = refundable(payment);
  return rupees(Math.min(paise(left), Math.round((paise(Number(payment.amount_inr)) * Math.max(0, Math.min(100, refundPct))) / 100)));
}
