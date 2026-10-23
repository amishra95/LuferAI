import { FatalError, getStepMetadata, RetryableError } from "workflow";

import { deadLetterBookingExport, exportBookingExpense } from "@/lib/finance/export-dispatcher";
import type { ExpenseProvider } from "@/lib/finance/expense-adapters";
import { backoffMs, MAX_RETRIES } from "@/lib/jobs/retry-policy";
import { publishExpense } from "@/lib/telemetry/live";

/**
 * Durable export of one confirmed booking to an expense/ERP system, started by
 * exportBookingToERP (lib/finance/export-queue.ts).
 *
 *   1. send         the dispatcher's export (idempotent per booking + provider;
 *                   each attempt is counted on the expense_exports row). Up to
 *                   5 attempts, backing off 30s, 1m, 2m, 4m
 *                   (lib/jobs/retry-policy.ts); permanent failures (4xx, an
 *                   unexportable booking) stop at once.
 *   2. dead-letter  when every attempt failed: the row becomes 'dead_lettered'
 *                   with the last error, for finance to see and re-send.
 */

export interface ErpExportInput {
  bookingId: string;
  provider: ExpenseProvider;
  /** The Approver or admin who asked for it (expense_exports.requested_by). */
  requestedBy: string | null;
}

export type ErpExportResult = { bookingId: string; provider: ExpenseProvider; status: "delivered" | "mocked" | "skipped" } | { bookingId: string; provider: ExpenseProvider; status: "dead_lettered"; error: string };

/** Step errors are deserialized into the workflow, so don't rely on `instanceof Error`. */
const messageOf = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err && typeof err.message === "string" ? err.message : "Export failed";

export async function erpExportWorkflow(input: ErpExportInput): Promise<ErpExportResult> {
  "use workflow";

  try {
    const status = await sendExport(input);
    return { bookingId: input.bookingId, provider: input.provider, status };
  } catch (err) {
    const error = messageOf(err);
    await deadLetterExport(input, error);
    return { bookingId: input.bookingId, provider: input.provider, status: "dead_lettered", error };
  }
}

/** One export attempt. Throws to retry (with backoff) or, for permanent failures, to stop. */
export async function sendExport(input: ErpExportInput): Promise<"delivered" | "mocked" | "skipped"> {
  "use step";
  const outcome = await exportBookingExpense(input.bookingId, { provider: input.provider, requestedBy: input.requestedBy });
  if (outcome.status !== "failed") {
    await publishExpense(input.bookingId, input.provider, outcome.status);
    return outcome.status;
  }
  if (!outcome.retryable) throw new FatalError(outcome.error);
  throw new RetryableError(outcome.error, { retryAfter: backoffMs(currentAttempt()) });
}
sendExport.maxRetries = MAX_RETRIES;

export async function deadLetterExport(input: ErpExportInput, error: string): Promise<void> {
  "use step";
  await deadLetterBookingExport(input.bookingId, input.provider, error);
  await publishExpense(input.bookingId, input.provider, "failed");
}

/** 1-based attempt of the running step; 1 outside the workflow runtime (inline fallback, tests). */
function currentAttempt(): number {
  try {
    return getStepMetadata().attempt;
  } catch {
    return 1;
  }
}
