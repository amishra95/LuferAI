import "server-only";

import { createHash, createHmac } from "node:crypto";

import { findExpenseExport, listBookings, recordExpenseExport } from "@/lib/data";
import { buildExpenseReceipt, type ExpenseReceipt } from "@/lib/finance/receipt";
import type { Json } from "@/lib/supabase/database.generated";

const env = (k: string) => (process.env[k] ?? "").trim();

export type DispatchOutcome =
  | { status: "delivered" | "mocked"; exportId?: string; duplicate?: false }
  | { status: "failed"; error: string; duplicate?: false }
  | { status: "skipped"; duplicate: true };

/** One JSON line per export, for log pipelines (Datadog, CloudWatch, …). */
function audit(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ audit: "expense_export", at: new Date().toISOString(), ...entry }));
}

/**
 * Exports a confirmed booking to finance: builds the structured receipt, then
 * POSTs it to EXPENSE_WEBHOOK_URL (signed with EXPENSE_WEBHOOK_SECRET as
 * X-Lufer-Signature: sha256=<hmac>) or, with no URL configured, records a mock
 * dispatch. Idempotent per booking: a second confirmation never double-posts.
 * Never throws; callers must not fail the confirmation over an export.
 */
export async function dispatchBookingConfirmed(bookingId: string): Promise<DispatchOutcome> {
  try {
    if (await findExpenseExport(bookingId, "booking.confirmed")) {
      audit({ booking_id: bookingId, status: "skipped", reason: "already exported" });
      return { status: "skipped", duplicate: true };
    }
    const booking = (await listBookings()).find((b) => b.id === bookingId);
    if (!booking) throw new Error(`Booking ${bookingId} not found`);
    if (booking.status !== "CONFIRMED") throw new Error(`Booking ${bookingId} is ${booking.status}, not CONFIRMED`);

    const receipt: ExpenseReceipt = buildExpenseReceipt(
      { ...booking, company: booking.company, venue: { ...booking.venue } },
      new Date().toISOString()
    );
    const body = JSON.stringify(receipt);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const url = env("EXPENSE_WEBHOOK_URL");

    let status: "delivered" | "mocked" | "failed" = "mocked";
    let responseCode: number | null = null;
    let error: string | null = null;
    if (url) {
      try {
        const secret = env("EXPENSE_WEBHOOK_SECRET");
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Lufer-Event": "booking.confirmed",
            "X-Lufer-Payload-SHA256": sha256,
            ...(secret && { "X-Lufer-Signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }),
            // Lets the receiver dedupe if we ever retry.
            "Idempotency-Key": `booking.confirmed:${bookingId}`,
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

    const recorded = await recordExpenseExport({
      booking_id: booking.id,
      tenant_id: booking.company.id,
      event: "booking.confirmed",
      receipt: receipt as unknown as Json,
      payload: body,
      payload_sha256: sha256,
      destination: url || "mock",
      status,
      response_code: responseCode,
      error,
    });
    audit({
      booking_id: booking.id,
      tenant_id: booking.company.id,
      status: recorded ? status : "skipped",
      destination: url ? new URL(url).host : "mock",
      payload_sha256: sha256,
      cost_center: booking.cost_center,
      project_code: booking.project_code,
      invoice_total: receipt.tax.invoice_total,
      ...(error && { error }),
    });
    if (!recorded) return { status: "skipped", duplicate: true };
    return status === "failed" ? { status, error: error ?? "Delivery failed" } : { status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    audit({ booking_id: bookingId, status: "error", error: message });
    return { status: "failed", error: message };
  }
}
