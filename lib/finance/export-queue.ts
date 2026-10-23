import "server-only";

import { start } from "workflow/api";

import { exportBookingExpense, type DispatchOutcome } from "@/lib/finance/export-dispatcher";
import { erpExportWorkflow, type ErpExportInput } from "@/workflows/erp-export";

export type QueuedExport = { queued: true; runId: string } | { queued: false; outcome: DispatchOutcome };

/**
 * Hands a booking export to the durable ERP export workflow (retries with
 * backoff, then dead-letters; workflows/erp-export.ts). If the workflow can't
 * be started (runtime unavailable), exports inline once instead, so the export
 * still happens, just without durable retries.
 */
export async function queueBookingExport(input: ErpExportInput): Promise<QueuedExport> {
  try {
    const run = await start(erpExportWorkflow, [input]);
    return { queued: true, runId: run.runId };
  } catch (err) {
    console.error(`erp export: could not start the workflow for booking ${input.bookingId}; exporting inline`, err instanceof Error ? err.message : err);
    return { queued: false, outcome: await exportBookingExpense(input.bookingId, { provider: input.provider, requestedBy: input.requestedBy }) };
  }
}
