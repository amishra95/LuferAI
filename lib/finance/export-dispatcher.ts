import "server-only";

import { createHash, createHmac } from "node:crypto";

import { findExpenseExport, listBookings, listCompanies, recordExpenseExport, retryExpenseExport } from "@/lib/data";
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
    if (existing && existing.status !== "failed") {
      const provider = isExpenseProvider(existing.provider) ? existing.provider : "webhook";
      audit({ booking_id: bookingId, status: "skipped", reason: "already exported", provider });
      return { status: "skipped", provider, duplicate: true };
    }
    const [booking, companies] = await Promise.all([listBookings().then((bs) => bs.find((b) => b.id === bookingId)), listCompanies()]);
    if (!booking) throw new Error(`Booking ${bookingId} not found`);
    if (!EXPORTABLE.has(booking.status)) throw new Error(`Booking ${bookingId} is ${booking.status}, not confirmed`);
    const company = companies.find((c) => c.id === booking.company.id);
    const provider: ExpenseProvider = isExpenseProvider(company?.expense_provider) ? company.expense_provider : "webhook";

    const receipt: ExpenseReceipt = buildExpenseReceipt({ ...booking, company: booking.company, venue: { ...booking.venue } }, new Date().toISOString());
    const request = buildExpenseRequest(provider, receipt);
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
            "X-Lufer-Event": "booking.confirmed",
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
      booking_id: booking.id,
      tenant_id: booking.company.id,
      event: "booking.confirmed",
      provider,
      receipt: receipt as unknown as Json,
      payload: body,
      payload_sha256: sha256,
      destination: url || "mock",
      status,
      response_code: responseCode,
      error,
    };
    // A failed export is retried in place; a new one is inserted (once per booking + event).
    const recorded = existing ? await retryExpenseExport(existing.id, row) : await recordExpenseExport(row);
    audit({
      booking_id: booking.id,
      tenant_id: booking.company.id,
      provider,
      status: recorded ? status : "skipped",
      attempt: existing ? existing.attempts + 1 : 1,
      destination: url ? new URL(url).host : "mock",
      payload_sha256: sha256,
      cost_center: booking.cost_center,
      project_code: booking.project_code,
      invoice_total: receipt.tax.invoice_total,
      ...(error && { error }),
    });
    if (!recorded) return { status: "skipped", provider, duplicate: true };
    return status === "failed" ? { status, provider, error: error ?? "Delivery failed" } : { status, provider };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    audit({ booking_id: bookingId, status: "error", error: message });
    return { status: "failed", error: message };
  }
}

/** The export run when a venue confirms a booking. */
export const dispatchBookingConfirmed = exportBookingExpense;
