import { FatalError, getStepMetadata, RetryableError } from "workflow";

import { backoffMs, MAX_RETRIES } from "@/lib/jobs/retry-policy";
import { deadLetterTaxInvoice, issueTaxInvoiceDocument } from "@/lib/finance/tax-invoice";

/**
 * Durable rendering of a confirmed booking's GST tax invoice (print-ready HTML
 * with its SHA-256; lib/finance/tax-invoice-document.ts), started when the
 * booking is confirmed (lib/finance/tax-invoice-queue.ts).
 *
 *   1. render       render and store the document; idempotent. Up to 5
 *                   attempts with exponential backoff (lib/jobs/retry-policy.ts);
 *                   an unknown or unconfirmed booking stops at once.
 *   2. dead-letter  when every attempt failed: tax_invoice_documents.status
 *                   becomes 'dead_lettered' with the last error.
 */

export type TaxInvoiceResult = { bookingId: string; status: "rendered" | "unchanged"; sha256: string } | { bookingId: string; status: "dead_lettered"; error: string };

const messageOf = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err && typeof err.message === "string" ? err.message : "Rendering failed";

export async function taxInvoiceWorkflow(bookingId: string): Promise<TaxInvoiceResult> {
  "use workflow";

  try {
    const doc = await renderInvoice(bookingId);
    return { bookingId, ...doc };
  } catch (err) {
    const error = messageOf(err);
    await deadLetterInvoice(bookingId, error);
    return { bookingId, status: "dead_lettered", error };
  }
}

export async function renderInvoice(bookingId: string): Promise<{ status: "rendered" | "unchanged"; sha256: string }> {
  "use step";
  const outcome = await issueTaxInvoiceDocument(bookingId);
  if (outcome.status !== "failed") return outcome;
  if (!outcome.retryable) throw new FatalError(outcome.error);
  throw new RetryableError(outcome.error, { retryAfter: backoffMs(currentAttempt()) });
}
renderInvoice.maxRetries = MAX_RETRIES;

export async function deadLetterInvoice(bookingId: string, error: string): Promise<void> {
  "use step";
  await deadLetterTaxInvoice(bookingId, error);
}

/** 1-based attempt of the running step; 1 outside the workflow runtime (inline fallback, tests). */
function currentAttempt(): number {
  try {
    return getStepMetadata().attempt;
  } catch {
    return 1;
  }
}
