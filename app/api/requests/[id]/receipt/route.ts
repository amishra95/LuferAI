import { getCurrentMember } from "@/lib/auth/session";
import { getConciergeRequest } from "@/lib/concierge/request-store";
import { listCompanies } from "@/lib/data";
import { documentResponse } from "@/lib/finance/document-response";
import { requestReceiptModel } from "@/lib/finance/tax-invoice-document";
import { todayInIndia } from "@/lib/gst-engine";
import { entityName } from "@/lib/legal";
import { requestPayments } from "@/lib/payments/service";

/**
 * GET /api/requests/<id>/receipt: the receipt for a concierge quote the
 * company paid through Lufer, built from the payment (it isn't a numbered GST
 * document). ?format=pdf downloads it as a PDF. Only the request's company
 * and admins can open it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/requests/[id]/receipt">) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not_found" }, { status: 404 });

  try {
    const row = await getConciergeRequest(id);
    const mine = member.role === "ADMIN" || (member.role === "CLIENT" && member.companyId !== null && row?.company_id === member.companyId);
    if (!row || !mine) return Response.json({ error: "not_found" }, { status: 404 });
    const payment = (await requestPayments([id])).get(id);
    if (!payment) return Response.json({ error: "not_paid" }, { status: 404 });
    const company = row.company_id ? (await listCompanies()).find((c) => c.id === row.company_id) : null;
    const model = requestReceiptModel({
      receivedBy: entityName(),
      requestId: row.id,
      paidOn: todayInIndia(new Date(payment.captured_at ?? payment.updated_at)),
      venueName: row.venue_name ?? "the venue",
      eventDate: row.event_date,
      guests: row.guests,
      companyName: company?.legal_name ?? row.requester_email,
      companyGstin: company?.gstin ?? null,
      companyAddress: company?.billing_address ?? null,
      paid: Number(payment.amount_inr),
      quoteNote: row.quote_note,
      paymentRef: payment.provider_payment_id,
    });
    return documentResponse(request, { model, title: model.title });
  } catch (err) {
    console.error("api/requests/receipt: failed", err);
    return Response.json({ error: "Could not load the receipt." }, { status: 500 });
  }
}
