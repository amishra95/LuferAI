import { getCurrentMember } from "@/lib/auth/session";
import { listReceiptVouchers } from "@/lib/finance/billing-store";
import { documentBooking, documentResponse } from "@/lib/finance/document-response";
import type { BillDocument } from "@/lib/finance/tax-invoice-document";

/**
 * GET /api/bookings/<id>/receipt-voucher: the receipt voucher for the booking's
 * deposit (lib/finance/billing-store.ts), a print-ready HTML page.
 * ?format=pdf downloads it as a PDF. Only the booking's company, its venue and
 * admins can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]/receipt-voucher">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const booking = await documentBooking(member, id);
    if (!booking) return Response.json({ error: "not_found" }, { status: 404 });
    const [voucher] = await listReceiptVouchers(id);
    if (!voucher) return Response.json({ error: "not_issued" }, { status: 404 });
    return documentResponse(request, { html: voucher.html, model: (voucher.data as BillDocument | null) ?? null, title: `Receipt Voucher ${voucher.voucher_number}` });
  } catch (err) {
    console.error("api/bookings/receipt-voucher: failed", err);
    return Response.json({ error: "Could not load the document." }, { status: 500 });
  }
}
