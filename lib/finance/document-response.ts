import "server-only";

import type { Member } from "@/lib/auth/session";
import { listBookings } from "@/lib/data";
import { documentFilename, renderDocumentPdf } from "@/lib/finance/document-pdf";
import { documentHtml, type BillDocument } from "@/lib/finance/tax-invoice-document";
import { DOCUMENT_POLICY } from "@/lib/security-headers";

/**
 * Shared by the booking document routes (tax invoice, receipt voucher, refund
 * voucher, payment receipt): who may open a booking's documents, and how one
 * is sent. The HTML page opens in the browser (?download=1 saves it);
 * ?format=pdf sends the PDF as a download.
 */

/** The booking, if this member may see its documents: its company, its venue, or an admin. */
export async function documentBooking(member: Member, bookingId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const scope = member.role === "ADMIN" ? {} : member.role === "CLIENT" && member.companyId ? { companyId: member.companyId } : member.role === "PROPERTY" && member.venueId ? { venueId: member.venueId } : null;
  const [booking] = scope ? await listBookings({ ...scope, ids: [bookingId] }) : [];
  return booking ?? null;
}

export async function documentResponse(request: Request, doc: { html?: string | null; sha256?: string | null; model: BillDocument | null; title: string }): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const base = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": DOCUMENT_POLICY };

  if (params.get("format") === "pdf") {
    // Documents issued before PDFs existed have no stored model.
    if (!doc.model) return Response.json({ error: "pdf_unavailable" }, { status: 404 });
    const bytes = await renderDocumentPdf(doc.model);
    return new Response(Buffer.from(bytes), {
      headers: { ...base, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${documentFilename(doc, "pdf")}"` },
    });
  }

  const html = doc.html ?? (doc.model ? documentHtml(doc.model) : null);
  if (!html) return Response.json({ error: "not_issued" }, { status: 404 });
  return new Response(html, {
    headers: {
      ...base,
      "Content-Type": "text/html; charset=utf-8",
      ...(doc.sha256 ? { "X-Content-SHA256": doc.sha256 } : {}),
      ...(params.get("download") === "1" ? { "Content-Disposition": `attachment; filename="${documentFilename(doc, "html")}"` } : {}),
    },
  });
}
