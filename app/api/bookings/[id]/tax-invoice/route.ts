import { getCurrentMember } from "@/lib/auth/session";
import { getTaxInvoiceDocument, isIssuedInvoice, listBookings } from "@/lib/data";
import { DOCUMENT_POLICY } from "@/lib/security-headers";

/**
 * GET /api/bookings/<id>/tax-invoice: the booking's GST tax invoice as issued
 * after the event by workflows/tax-invoice.ts, a print-ready HTML page (use the
 * browser's Save as PDF). Unnumbered drafts from before issuing aren't served. ?download=1 sends it as an attachment. Only the booking's company,
 * its venue and admins can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]/tax-invoice">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const scope = member.role === "ADMIN" ? {} : member.role === "CLIENT" && member.companyId ? { companyId: member.companyId } : member.role === "PROPERTY" && member.venueId ? { venueId: member.venueId } : null;
    const [booking] = scope ? await listBookings({ ...scope, ids: [id] }) : [];
    if (!booking) return Response.json({ error: "not_found" }, { status: 404 });
    const doc = await getTaxInvoiceDocument(id);
    if (!isIssuedInvoice(doc) || !doc!.html) return Response.json({ error: "not_issued", status: doc?.status ?? null }, { status: 404 });

    const download = new URL(request.url).searchParams.get("download") === "1";
    const filename = `tax-invoice-${doc!.invoice_number}`.replace(/[^A-Za-z0-9._-]/g, "-");
    return new Response(doc!.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        // The document is static HTML we generated; nothing in it should run or load.
        "Content-Security-Policy": DOCUMENT_POLICY,
        "X-Content-Type-Options": "nosniff",
        "X-Content-SHA256": doc!.html_sha256 ?? "",
        ...(download ? { "Content-Disposition": `attachment; filename="${filename}.html"` } : {}),
      },
    });
  } catch (err) {
    console.error("api/bookings/tax-invoice: failed", err);
    return Response.json({ error: "Could not load the tax invoice." }, { status: 500 });
  }
}
