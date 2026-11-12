import { getCurrentMember } from "@/lib/auth/session";
import { listBookings } from "@/lib/data";
import { listReceiptVouchers } from "@/lib/finance/billing-store";
import { DOCUMENT_POLICY } from "@/lib/security-headers";

/**
 * GET /api/bookings/<id>/receipt-voucher: the receipt voucher for the booking's
 * deposit (lib/finance/billing-store.ts), a print-ready HTML page. ?download=1
 * sends it as an attachment. Only the booking's company, its venue and admins
 * can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]/receipt-voucher">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const scope = member.role === "ADMIN" ? {} : member.role === "CLIENT" && member.companyId ? { companyId: member.companyId } : member.role === "PROPERTY" && member.venueId ? { venueId: member.venueId } : null;
    const [booking] = scope ? await listBookings({ ...scope, ids: [id] }) : [];
    if (!booking) return Response.json({ error: "not_found" }, { status: 404 });
    const [voucher] = await listReceiptVouchers(id);
    if (!voucher) return Response.json({ error: "not_issued" }, { status: 404 });

    const download = new URL(request.url).searchParams.get("download") === "1";
    const filename = `receipt-voucher-${voucher.voucher_number}`.replace(/[^A-Za-z0-9._-]/g, "-");
    return new Response(voucher.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": DOCUMENT_POLICY,
        "X-Content-Type-Options": "nosniff",
        ...(download ? { "Content-Disposition": `attachment; filename="${filename}.html"` } : {}),
      },
    });
  } catch (err) {
    console.error("api/bookings/receipt-voucher: failed", err);
    return Response.json({ error: "Could not load the receipt voucher." }, { status: 500 });
  }
}
