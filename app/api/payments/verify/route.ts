import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentMember } from "@/lib/auth/session";
import { confirmCheckout, PaymentError } from "@/lib/payments/service";

/**
 * POST the fields Razorpay Checkout hands the browser on success. The
 * signature is verified against our own order, the payment's state is read
 * from Razorpay and applied, and the new status is returned, so the page is
 * right at once. The webhook stays the backstop for a closed tab.
 */
const Body = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (member.role !== "CLIENT" && member.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    const result = await confirmCheckout(member, {
      orderId: parsed.data.razorpay_order_id,
      paymentRef: parsed.data.razorpay_payment_id,
      signature: parsed.data.razorpay_signature,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: err.status });
    // The webhook will still settle it; the page refreshes to pick that up.
    console.error("payments/verify failed", err);
    return NextResponse.json({ error: "Could not confirm the payment yet." }, { status: 502 });
  }
}
