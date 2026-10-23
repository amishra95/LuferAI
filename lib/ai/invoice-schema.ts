/**
 * What the vision model reads off a venue's GST invoice, and its clean-up.
 * Pure (zod only) so tests/ai/ocr.test.mjs can exercise it;
 * lib/ai/receipt-parser.ts runs the model, lib/finance/invoice-reconcile.ts
 * compares the result with the booking.
 *
 * The model is asked to copy, not compute: every field is nullable, and
 * normalizeInvoice only reformats (GSTIN case, day-first dates, rupees to the
 * paisa). Checking the figures is the reconciler's job.
 */
import { z } from "zod";

import { roundInr } from "../gst-engine.ts";

const amount = z.number().nullable();

export const InvoiceLineItem = z.object({
  description: z.string().describe("The line as printed"),
  hsn_sac: z.string().nullable().describe("HSN or SAC code printed on the line, else null"),
  quantity: z.number().nullable(),
  unit_price: amount.describe("Rate per unit, INR"),
  amount: amount.describe("Line amount before GST, INR"),
});

export const InvoiceExtraction = z.object({
  vendor_gstin: z.string().nullable().describe("Supplier (issuer) GSTIN, 15 characters"),
  buyer_gstin: z.string().nullable().describe("Recipient (billed to) GSTIN, if printed"),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable().describe("YYYY-MM-DD"),
  subtotal: amount.describe("Taxable value before GST, INR"),
  cgst: amount,
  sgst: amount,
  igst: amount,
  total_amount: amount.describe("Invoice total after GST, INR"),
  line_items: z.array(InvoiceLineItem),
});
export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

/** What uploads the parser accepts: PDFs and the image formats phones produce. */
export const INVOICE_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export type InvoiceMediaType = (typeof INVOICE_MEDIA_TYPES)[number];
export const isInvoiceMediaType = (t: string): t is InvoiceMediaType => (INVOICE_MEDIA_TYPES as readonly string[]).includes(t);

/** Under Vercel's 4.5 MB request body limit, with room for the form's other fields. */
export const MAX_INVOICE_BYTES = 4 * 1024 * 1024;

/** GSTINs as written on invoices ("29 AABCN 4821K1ZA", lower case) → canonical, or null. */
export function normalizeGstin(raw: string | null | undefined): string | null {
  const g = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  return g || null;
}

/** YYYY-MM-DD, or a day-first DD/MM/YYYY, DD-MM-YYYY or DD.MM.YYYY → YYYY-MM-DD; anything else → null. */
export function normalizeInvoiceDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects 31/02 and month 13 rather than letting Date roll them over.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : roundInr(v));

/** The model's output, reformatted: canonical GSTINs, ISO dates, amounts to the paisa, trimmed text. */
export function normalizeInvoice(x: InvoiceExtraction): InvoiceExtraction {
  return {
    vendor_gstin: normalizeGstin(x.vendor_gstin),
    buyer_gstin: normalizeGstin(x.buyer_gstin),
    invoice_number: x.invoice_number?.trim() || null,
    invoice_date: normalizeInvoiceDate(x.invoice_date),
    subtotal: money(x.subtotal),
    cgst: money(x.cgst),
    sgst: money(x.sgst),
    igst: money(x.igst),
    total_amount: money(x.total_amount),
    line_items: x.line_items.map((l) => ({
      description: l.description.trim(),
      hsn_sac: l.hsn_sac?.replace(/\s/g, "") || null,
      quantity: l.quantity != null && Number.isFinite(l.quantity) ? l.quantity : null,
      unit_price: money(l.unit_price),
      amount: money(l.amount),
    })),
  };
}
