import "server-only";

import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";

import { InvoiceExtraction, normalizeInvoice, type InvoiceMediaType } from "@/lib/ai/invoice-schema";
import { getLanguageModel } from "@/lib/ai/model";
import { invoiceExtractionInstructions } from "@/lib/ai/prompts";
import { tracer } from "@/lib/tracer";

/**
 * Reads a venue's GST tax invoice (PDF or photo) with the vision model:
 * Gemini Flash by default (GEMINI_MODEL), failing over only to providers whose
 * models read documents (lib/ai/model.ts, `files: true`). The fields are
 * InvoiceExtraction (lib/ai/invoice-schema.ts), normalised; nothing is
 * computed here. Reconciling them with the booking is
 * lib/finance/invoice-reconcile.ts.
 */

/** No configured provider can read documents. */
export class InvoiceReaderUnavailableError extends Error {}
/** The model answered, but not with an invoice (blank page, not an invoice, unreadable scan). */
export class InvoiceUnreadableError extends Error {}

export interface ParsedInvoice {
  invoice: InvoiceExtraction;
  /** The model that read it, for the audit note. */
  model: string;
  tokens: number;
}

export async function parseInvoiceDocument(file: { data: Uint8Array; mediaType: InvoiceMediaType; filename?: string }): Promise<ParsedInvoice> {
  const model = getLanguageModel({ files: true, usage: { agent: "invoice-reader", source: "api" } });
  if (!model) throw new InvoiceReaderUnavailableError("No AI provider that reads documents is configured (set GOOGLE_GENERATIVE_AI_API_KEY).");
  try {
    return await tracer.trace("llm.generate", async (span) => {
      const r = await generateText({
        model,
        output: Output.object({ schema: InvoiceExtraction }),
        instructions: invoiceExtractionInstructions(),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extract this invoice." },
              { type: "file", data: file.data, mediaType: file.mediaType, ...(file.filename && { filename: file.filename }) },
            ],
          },
        ],
        temperature: 0,
      });
      span.setAttributes({ model: r.response.modelId, tokens: r.totalUsage.totalTokens, mediaType: file.mediaType, bytes: file.data.byteLength });
      return { invoice: normalizeInvoice(r.output), model: r.response.modelId, tokens: r.totalUsage.totalTokens ?? 0 };
    });
  } catch (err) {
    // No output at all, or output that isn't JSON / doesn't fit the schema (not an invoice, unreadable scan).
    if (NoOutputGeneratedError.isInstance(err) || NoObjectGeneratedError.isInstance(err)) throw new InvoiceUnreadableError("Couldn't read an invoice in that file. Upload a clearer scan or the original PDF.");
    throw err;
  }
}
