import "server-only";

import { createHash, createHmac } from "node:crypto";

import { findExpenseExport, listBookings, listCatalogOrders, listCompanies, recordExpenseExport, retryExpenseExport } from "@/lib/data";
import type { TaxInvoicePayload } from "@/lib/gst-engine";
import type { ExpenseExport } from "@/lib/supabase/database.types";
import { buildExpenseRequest, isExpenseProvider, providerEnv, type ExpenseProvider } from "@/lib/finance/expense-adapters";
import { buildExpenseReceipt, type ExpenseReceipt } from "@/lib/finance/receipt";
import type { Json } from "@/lib/supabase/database.generated";

const env = (k: string) => (process.env[k] ?? "").trim();

export type DispatchOutcome =
  | { status: "delivered" | "mocked"; provider: ExpenseProvider; exportId?: string; duplicate?: false }
  | { status: "failed"; provider?: ExpenseProvider; error: string; duplicate?: false }
  | { status: "skipped"; provider: ExpenseProvider; duplicate: true };

/** One JSON line per export, for log pipelines (Datadog, CloudWatch, …). */
function audit(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ audit: "expense_export", at: new Date().toISOString(), ...entry }));
}

/** Statuses a booking can be exported from: confirmed onwards. */
const EXPORTABLE = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);

interface ExportSubject {
  kind: "booking" | "order";
  id: string;
  tenantId: string;
  costCenter: string | null;
  projectCode: string | null;
  receipt: ExpenseReceipt;
}

/** Sends one receipt to the company's provider and records it (retrying a failed export in place). */
async function deliver(subject: ExportSubject, existing: ExpenseExport | null): Promise<DispatchOutcome> {
  const companies = await listCompanies();
  const company = companies.find((c) => c.id === subject.tenantId);
  const provider: ExpenseProvider = isExpenseProvider(company?.expense_provider) ? company.expense_provider : "webhook";
  const event = subject.receipt.event;
  const request = buildExpenseRequest(provider, subject.receipt);
  const body = JSON.stringify(request.body);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const keys = providerEnv(provider);
  const url = env(keys.url);

  let status: "delivered" | "mocked" | "failed" = "mocked";
  let responseCode: number | null = null;
  let error: string | null = null;
  if (url) {
    try {
      const secret = env(keys.token);
      const auth: Record<string, string> =
        provider === "webhook"
          ? secret
            ? { "X-Lufer-Signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }
            : {}
          : secret
            ? { Authorization: `Bearer ${secret}` }
            : {};
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lufer-Event": event,
          "X-Lufer-Payload-SHA256": sha256,
          ...auth,
          // Lets the receiver dedupe retries.
          "Idempotency-Key": request.idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      responseCode = res.status;
      status = res.ok ? "delivered" : "failed";
      if (!res.ok) error = `Receiver returned ${res.status}`;
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Delivery failed";
    }
  }

  const row = {
    booking_id: subject.kind === "booking" ? subject.id : null,
    catalog_order_id: subject.kind === "order" ? subject.id : null,
    tenant_id: subject.tenantId,
    event,
    provider,
    receipt: subject.receipt as unknown as Json,
    payload: body,
    payload_sha256: sha256,
    destination: url || "mock",
    status,
    response_code: responseCode,
    error,
  };
  const recorded = existing ? await retryExpenseExport(existing.id, row) : await recordExpenseExport(row);
  audit({
    [subject.kind === "booking" ? "booking_id" : "order_id"]: subject.id,
    tenant_id: subject.tenantId,
    provider,
    status: recorded ? status : "skipped",
    attempt: existing ? existing.attempts + 1 : 1,
    destination: url ? new URL(url).host : "mock",
    payload_sha256: sha256,
    cost_center: subject.costCenter,
    project_code: subject.projectCode,
    invoice_total: subject.receipt.tax.invoice_total,
    ...(error && { error }),
  });
  if (!recorded) return { status: "skipped", provider, duplicate: true };
  return status === "failed" ? { status, provider, error: error ?? "Delivery failed" } : { status, provider };
}

/** A delivered or mocked export is final; a failed one is retried. */
function alreadyExported(existing: ExpenseExport | null, subjectId: string): DispatchOutcome | null {
  if (!existing || existing.status === "failed") return null;
  const provider = isExpenseProvider(existing.provider) ? existing.provider : "webhook";
  audit({ subject: subjectId, status: "skipped", reason: "already exported", provider });
  return { status: "skipped", provider, duplicate: true };
}

/**
 * Exports a confirmed booking to the company's expense system
 * (companies.expense_provider: signed webhook, Ramp, Brex or Concur; see
 * lib/finance/expense-adapters.ts). Without that provider's URL configured the
 * export is recorded as mocked. Idempotent per booking: a delivered or mocked
 * export is never re-sent; a failed one is retried in place (attempts + 1).
 * Never throws; callers must not fail the confirmation over an export.
 */
export async function exportBookingExpense(bookingId: string): Promise<DispatchOutcome> {
  try {
    const existing = await findExpenseExport(bookingId, "booking.confirmed");
    const done = alreadyExported(existing, bookingId);
    if (done) return done;
    const booking = (await listBookings()).find((b) => b.id === bookingId);
    if (!booking) throw new Error(`Booking ${bookingId} not found`);
    if (!EXPORTABLE.has(booking.status)) throw new Error(`Booking ${bookingId} is ${booking.status}, not confirmed`);
    const receipt = buildExpenseReceipt({ ...booking, company: booking.company, venue: { ...booking.venue } }, new Date().toISOString());
    return await deliver({ kind: "booking", id: booking.id, tenantId: booking.company.id, costCenter: booking.cost_center, projectCode: booking.project_code, receipt }, existing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    audit({ booking_id: bookingId, status: "error", error: message });
    return { status: "failed", error: message };
  }
}

/** The export run when a venue confirms a booking. */
export const dispatchBookingConfirmed = exportBookingExpense;

const ORDER_EXPORTABLE = new Set(["CONFIRMED", "SHIPPED", "DELIVERED", "SETTLED"]);

/**
 * Exports a confirmed catalogue order, the same way: the supplier is the
 * receipt's "venue", units its party size, and the invoice is the order's own
 * (at the item's HSN/SAC rate). Never throws.
 */
export async function exportOrderExpense(orderId: string): Promise<DispatchOutcome> {
  try {
    const existing = await findExpenseExport(orderId, "order.confirmed");
    const done = alreadyExported(existing, orderId);
    if (done) return done;
    const [order] = await listCatalogOrders({ ids: [orderId] });
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (!ORDER_EXPORTABLE.has(order.status)) throw new Error(`Order ${orderId} is ${order.status}, not confirmed`);
    const [company] = (await listCompanies()).filter((c) => c.id === order.tenant_id);
    const invoice = order.invoice as unknown as TaxInvoicePayload;
    const receipt = buildExpenseReceipt(
      {
        id: order.id,
        status: order.status,
        event_date: order.event_date ?? order.needed_by ?? order.created_at.slice(0, 10),
        party_size: order.quantity,
        budget_per_head_inr: order.unit_price_inr,
        total_amount_inr: order.total_amount_inr,
        notes: order.notes,
        cost_center: order.cost_center,
        project_code: order.project_code,
        billing_gstin: invoice.recipient.gstin === company?.gstin ? null : invoice.recipient.gstin,
        commission_rate: 0,
        commission_inr: 0,
        company: { id: order.tenant_id, legal_name: order.company_name, gstin: company?.gstin ?? invoice.recipient.gstin },
        venue: { id: order.partner_id, name: order.partner_name, city: invoice.supplier.state_name, gstin: invoice.supplier.gstin },
        invoice,
      },
      new Date().toISOString(),
      "order.confirmed"
    );
    return await deliver({ kind: "order", id: order.id, tenantId: order.tenant_id, costCenter: order.cost_center, projectCode: order.project_code, receipt }, existing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    audit({ order_id: orderId, status: "error", error: message });
    return { status: "failed", error: message };
  }
}
