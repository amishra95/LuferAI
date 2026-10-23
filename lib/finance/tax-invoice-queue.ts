import "server-only";

import { start } from "workflow/api";

import { issueTaxInvoiceDocument } from "@/lib/finance/tax-invoice";
import { taxInvoiceWorkflow } from "@/workflows/tax-invoice";

/**
 * Starts rendering a confirmed booking's tax invoice document in the durable
 * workflow (workflows/tax-invoice.ts). If the workflow can't be started, renders
 * inline once instead. Never throws: callers must not fail a confirmation over
 * its invoice document.
 */
export async function queueTaxInvoice(bookingId: string): Promise<void> {
  try {
    await start(taxInvoiceWorkflow, [bookingId]);
  } catch (err) {
    console.error(`tax invoice: could not start the workflow for booking ${bookingId}; rendering inline`, err instanceof Error ? err.message : err);
    await issueTaxInvoiceDocument(bookingId);
  }
}
