/**
 * Retry policy for the durable finance jobs (workflows/erp-export.ts,
 * workflows/tax-invoice.ts): MAX_ATTEMPTS in all, exponential backoff between
 * them (30s, 1m, 2m, 4m), then the job is dead-lettered and its audit row says
 * so (expense_exports / tax_invoice_documents status 'dead_lettered').
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/finance/durable-jobs.test.mjs).
 */

export const MAX_ATTEMPTS = 5;
/** Workflow steps count retries after the first attempt (step.maxRetries). */
export const MAX_RETRIES = MAX_ATTEMPTS - 1;

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60_000;

/** How long to wait after `attempt` (1-based) failed before the next one. */
export function backoffMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (n - 1));
}

/**
 * Whether a receiver's HTTP status is worth retrying: timeouts, too-early, rate
 * limits, server errors, and 401 (the access token may have been refreshed by
 * the next attempt). Other 4xx are the request's fault and won't change.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 425 || status === 429 || status >= 500;
}
