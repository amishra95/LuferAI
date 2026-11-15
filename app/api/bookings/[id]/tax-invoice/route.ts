import { getCurrentMember } from "@/lib/auth/session";
import { getTaxInvoiceDocument, isIssuedInvoice } from "@/lib/data";
import { documentBooking, documentResponse } from "@/lib/finance/document-response";
import type { BillDocument } from "@/lib/finance/tax-invoice-document";

/**
 * GET /api/bookings/<id>/tax-invoice: the booking's GST tax invoice as issued
 * after the event by workflows/tax-invoice.ts, a print-ready HTML page.
 * ?format=pdf downloads it as a PDF; ?download=1 saves the HTML. Unnumbered
 * drafts from before issuing aren't served. Only the booking's company, its
 * venue and admins can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]/tax-invoice">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const booking = await documentBooking(member, id);
    if (!booking) return Response.json({ error: "not_found" }, { status: 404 });
    const doc = await getTaxInvoiceDocument(id);
    if (!isIssuedInvoice(doc) || !doc!.html) return Response.json({ error: "not_issued", status: doc?.status ?? null }, { status: 404 });
    return documentResponse(request, { html: doc!.html, sha256: doc!.html_sha256, model: (doc!.data as BillDocument | null) ?? null, title: `Tax Invoice ${doc!.invoice_number}` });
  } catch (err) {
    console.error("api/bookings/tax-invoice: failed", err);
    return Response.json({ error: "Could not load the document." }, { status: 500 });
  }
}
