import { getCurrentMember } from "@/lib/auth/session";
import { paymentReceiptFor } from "@/lib/finance/billing-store";
import { documentBooking, documentResponse } from "@/lib/finance/document-response";
import type { BillDocument } from "@/lib/finance/tax-invoice-document";

/**
 * GET /api/bookings/<id>/payment-receipt: the receipt for the balance paid
 * against the booking's tax invoice, built from the payment (it isn't a
 * numbered GST document). ?format=pdf downloads it as a PDF. Only the
 * booking's company, its venue and admins can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]/payment-receipt">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const booking = await documentBooking(member, id);
    if (!booking) return Response.json({ error: "not_found" }, { status: 404 });
    const model: BillDocument | null = await paymentReceiptFor(id);
    if (!model) return Response.json({ error: "not_paid" }, { status: 404 });
    return documentResponse(request, { model, title: model.title });
  } catch (err) {
    console.error("api/bookings/payment-receipt: failed", err);
    return Response.json({ error: "Could not load the document." }, { status: 500 });
  }
}
