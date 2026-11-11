import "server-only";

import { start } from "workflow/api";

import { issueTaxInvoiceDocument } from "@/lib/finance/tax-invoice";
import { taxInvoiceWorkflow } from "@/workflows/tax-invoice";

/**
 * Starts issuing a booking's tax invoice in the durable workflow
 * (workflows/tax-invoice.ts), once its event has happened. If the workflow
 * can't be started, issues inline once instead. Never throws: callers must not
 * fail a status change over its invoice.
 */
export async function queueTaxInvoice(bookingId: string): Promise<void> {
  try {
    await start(taxInvoiceWorkflow, [bookingId]);
  } catch (err) {
    console.error(`tax invoice: could not start the workflow for booking ${bookingId}; rendering inline`, err instanceof Error ? err.message : err);
    await issueTaxInvoiceDocument(bookingId);
  }
}
