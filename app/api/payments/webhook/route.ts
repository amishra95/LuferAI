import { NextResponse, type NextRequest } from "next/server";

import { detectWebhookProvider, getGateway, WebhookSignatureError } from "@/lib/payments/gateways";
import { applyWebhookEvent } from "@/lib/payments/service";

/**
 * One endpoint for both providers, told apart by their signature header:
 *   Razorpay → X-Razorpay-Signature (HMAC-SHA256 of the raw body, RAZORPAY_WEBHOOK_SECRET)
 *   Stripe   → Stripe-Signature (STRIPE_WEBHOOK_SECRET)
 * Subscribe to: payment.authorized, payment.captured, payment.failed (Razorpay);
 * checkout.session.completed, checkout.session.expired, payment_intent.*, charge.refunded (Stripe).
 */
export async function POST(request: NextRequest) {
  const provider = detectWebhookProvider(request.headers);
  const gateway = provider ? getGateway(provider) : null;
  if (!provider || !gateway) return NextResponse.json({ error: "unknown_provider" }, { status: 400 });

  // Signatures cover the exact bytes received — read the raw body, never re-serialise.
  const rawBody = await request.text();

  let event;
  try {
    event = gateway.parseWebhook(rawBody, request.headers);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      console.warn(`Rejected ${provider} webhook: ${err.message}`);
      return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }
    throw err;
  }

  try {
    const outcome = await applyWebhookEvent(provider, event);
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    // 5xx → the provider retries; events are idempotent on (provider, event_id).
    console.error(`Failed to apply ${provider} event ${event.eventId}`, err);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
