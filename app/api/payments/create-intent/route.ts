import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentMember } from "@/lib/auth/session";
import { createOrderCheckout, MarketplaceError } from "@/lib/marketplace/service";
import { createDepositCheckout, PaymentError } from "@/lib/payments/service";
import { siteUrl } from "@/lib/site-url";

/**
 * POST { bookingId } → authorise a deposit for a pending booking.
 * Returns either a Razorpay order (open Checkout.js) or a Stripe Checkout URL,
 * plus the GST invoice snapshot (rate-card discount, tax heads, deposit, balance).
 *
 * POST { orderId } → authorise a catalogue order's invoice total (Razorpay only:
 * it's split to the partner through Route; lib/marketplace/service.ts).
 */
const Body = z.union([z.object({ bookingId: z.uuid() }), z.object({ orderId: z.uuid() })]);

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (member.role !== "CLIENT" && member.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    const origin = siteUrl(request.nextUrl.origin);
    const result = "orderId" in parsed.data ? await createOrderCheckout(parsed.data.orderId, member, origin) : await createDepositCheckout(parsed.data.bookingId, member, origin);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PaymentError || err instanceof MarketplaceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("create-intent failed", err);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 502 });
  }
}
