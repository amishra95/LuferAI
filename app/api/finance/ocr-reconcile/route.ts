import { z } from "zod";

import { isInvoiceMediaType, MAX_INVOICE_BYTES } from "@/lib/ai/invoice-schema";
import { aiUnavailableResponse, isAiUnavailable } from "@/lib/ai/model";
import { InvoiceReaderUnavailableError, InvoiceUnreadableError, parseInvoiceDocument } from "@/lib/ai/receipt-parser";
import { getCurrentMember } from "@/lib/auth/session";
import { listBookings } from "@/lib/data";
import { todayInIndia } from "@/lib/gst-engine";
import { reconcileInvoice } from "@/lib/finance/invoice-reconcile";
import { itcStatusOf } from "@/lib/finance/itc";
import { tracer } from "@/lib/tracer";

/**
 * POST multipart/form-data { file, bookingId } → the venue's invoice read by
 * the vision model (lib/ai/receipt-parser.ts) and checked against the booking
 * (lib/finance/invoice-reconcile.ts): `check.status` is verified, or
 * discrepancies with the findings.
 *
 * Read-only: it never sets the booking's ITC decision. That stays with
 * Approvers and admins on /client (setItcDecision), who decide with the check
 * in hand; `check.note` is written to go in their decision note. Approvers,
 * Finance viewers and admins can run it, on their own company's bookings
 * (admins, any).
 *
 * Rate-limited with the AI routes (lib/ratelimit.ts).
 */
export const maxDuration = 120; // Seconds: reading a multi-page PDF can take a while

const Fields = z.object({ bookingId: z.uuid("Choose a booking.") });

async function handleOcrReconcile(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "Sign in to reconcile invoices." }, { status: 401 });
  const finance = member.role === "CLIENT" && member.companyId && (member.corporateRole === "APPROVER" || member.corporateRole === "FINANCE_VIEWER");
  if (member.role !== "ADMIN" && !finance) return Response.json({ error: "Only Approvers, Finance viewers and admins can reconcile invoices." }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the invoice as multipart/form-data." }, { status: 400 });
  }
  const fields = Fields.safeParse({ bookingId: form.get("bookingId") ?? undefined });
  if (!fields.success) return Response.json({ error: fields.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Attach the invoice (PDF or image)." }, { status: 400 });
  if (file.size > MAX_INVOICE_BYTES) return Response.json({ error: "The invoice must be under 4 MB." }, { status: 413 });
  if (!isInvoiceMediaType(file.type)) return Response.json({ error: "Upload a PDF, JPEG, PNG, WebP or HEIC file." }, { status: 415 });

  // Scoped like every finance read: client users only see their own company's bookings.
  const booking = (await listBookings(member.role === "ADMIN" ? { ids: [fields.data.bookingId] } : { companyId: member.companyId!, ids: [fields.data.bookingId] }))[0];
  if (!booking) return Response.json({ error: "Booking not found." }, { status: 404 });

  let parsed;
  try {
    parsed = await parseInvoiceDocument({ data: new Uint8Array(await file.arrayBuffer()), mediaType: file.type, filename: file.name || undefined });
  } catch (err) {
    if (err instanceof InvoiceReaderUnavailableError) return Response.json({ error: err.message }, { status: 503 });
    if (err instanceof InvoiceUnreadableError) return Response.json({ error: err.message }, { status: 422 });
    console.error("ocr-reconcile: reading the invoice failed", err);
    if (isAiUnavailable(err)) return aiUnavailableResponse();
    return Response.json({ error: "The invoice couldn't be read right now. Try again shortly." }, { status: 502 });
  }

  const billedGstin = booking.billing_gstin ?? booking.company.gstin;
  const check = reconcileInvoice({ invoice: parsed.invoice, expected: booking.invoice, venueGstin: booking.venue.gstin, billedGstin, today: todayInIndia() });
  tracer.annotate({ booking: booking.id.slice(0, 8), check: check.status, blocking: check.findings.filter((f) => f.severity === "block").length });

  return Response.json({
    bookingId: booking.id,
    invoice: parsed.invoice,
    check,
    // Unchanged by the check: where the booking's ITC stands, for the approver deciding next.
    itcStatus: itcStatusOf({ status: booking.status, itc_decision: booking.itc_decision, company_gstin: booking.company.gstin, billed_gstin: booking.billing_gstin, venue_gstin: booking.venue.gstin }),
    model: parsed.model,
  });
}

export const POST = tracer.traceResponse("api.finance.ocr-reconcile", handleOcrReconcile);
