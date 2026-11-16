import { getCurrentMember } from "@/lib/auth/session";
import { listRefundVouchers } from "@/lib/finance/billing-store";
import { documentBooking, documentResponse } from "@/lib/finance/document-response";
import type { BillDocument } from "@/lib/finance/tax-invoice-document";

/**
 * GET /api/bookings/<id>/refund-voucher: the refund voucher for a deposit
 * returned before any invoice (the latest, or ?refund=<id> for one of several).
 * ?format=pdf downloads it as a PDF. Only the booking's company, its venue and
 * admins can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]/refund-voucher">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const booking = await documentBooking(member, id);
    if (!booking) return Response.json({ error: "not_found" }, { status: 404 });
    const vouchers = await listRefundVouchers(id);
    const wanted = new URL(request.url).searchParams.get("refund");
    const voucher = wanted ? vouchers.find((v) => v.refund_id === wanted) : vouchers[0];
    if (!voucher) return Response.json({ error: "not_issued" }, { status: 404 });
    return documentResponse(request, { html: voucher.html, model: (voucher.data as BillDocument | null) ?? null, title: `Refund Voucher ${voucher.voucher_number}` });
  } catch (err) {
    console.error("api/bookings/refund-voucher: failed", err);
    return Response.json({ error: "Could not load the document." }, { status: 500 });
  }
}
