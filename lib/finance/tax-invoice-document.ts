/**
 * Renders a booking's GST tax invoice (the gst-engine's TaxInvoicePayload) as a
 * self-contained, print-ready HTML document (browsers save it as PDF), with its
 * SHA-256 so finance can verify a copy. Deterministic: the same invoice renders
 * to the same bytes, so re-running the job is a no-op.
 *
 * Every interpolated value is HTML-escaped.
 *
 * Pure: tests import it directly (tests/finance/durable-jobs.test.mjs).
 */

import type { TaxInvoicePayload } from "../gst-engine.ts";
import { escapeHtml, sha256 } from "../services/contracts/render.ts";

export interface TaxInvoiceSubject {
  bookingId: string;
  eventDate: string;
  partySize: number;
  supplierName: string;
  supplierCity: string | null;
  recipientName: string;
  invoice: TaxInvoicePayload;
}

const STYLE = `
  :root { color-scheme: light; }
  body { font: 14px/1.55 Georgia, "Times New Roman", serif; color: #1c1917; background: #fff; max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  h2 { font-size: .8rem; margin: 0 0 .25rem; text-transform: uppercase; letter-spacing: .06em; color: #57534e; }
  .meta { color: #57534e; font: 12px/1.5 ui-monospace, Menlo, monospace; margin-bottom: 1.5rem; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-bottom: 1.5rem; }
  .parties p { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0; }
  th { text-align: left; font-weight: normal; color: #57534e; font-size: 12px; padding: .4rem .25rem; }
  td { border-top: 1px solid #e7e5e4; padding: .4rem .25rem; vertical-align: top; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-top: 2px solid #1c1917; font-weight: bold; }
  .note { color: #57534e; font-size: 12px; margin-top: 1.5rem; }
  @page { margin: 18mm; }
  @media print { body { margin: 0 auto; } }
`;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => escapeHtml(inr.format(n));
const row = (cells: string[], cls = "") => `<tr${cls ? ` class="${cls}"` : ""}>${cells.join("")}</tr>`;
const td = (text: string, num = false) => `<td${num ? ' class="num"' : ""}>${text}</td>`;

function party(heading: string, name: string, gstin: string, state: string, city: string | null = null): string {
  const lines = [name, city, `GSTIN ${gstin}`, `State: ${state}`].filter((l): l is string => Boolean(l));
  return `<div><h2>${escapeHtml(heading)}</h2>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}</div>`;
}

/** The invoice document. Same subject → same bytes → same hash. */
export function renderTaxInvoice(subject: TaxInvoiceSubject): { html: string; sha256: string; invoiceNumber: string | null } {
  const { invoice } = subject;
  const number = invoice.invoice_number;
  const title = number ? `Tax Invoice ${number}` : `Tax Invoice · booking ${subject.bookingId.slice(0, 8)}`;
  const heads =
    invoice.gst_type === "IGST"
      ? [["IGST", invoice.tax_breakup.igst] as const]
      : [["CGST", invoice.tax_breakup.cgst] as const, ["SGST", invoice.tax_breakup.sgst] as const];

  const lines = [
    row([`<th>Description</th>`, `<th>${escapeHtml(invoice.tax.kind)}</th>`, `<th class="num">Qty</th>`, `<th class="num">Amount</th>`]),
    row([td(escapeHtml(`${invoice.sac.description} · event on ${subject.eventDate}`)), td(escapeHtml(invoice.sac.code)), td(escapeHtml(String(subject.partySize)), true), td(money(invoice.taxable_value), true)]),
    row([td("Taxable value"), td(""), td(""), td(money(invoice.taxable_value), true)]),
    ...heads.map(([head, tax]) => row([td(escapeHtml(`${head} @ ${tax.rate_percent}%`)), td(""), td(""), td(money(tax.amount), true)])),
    row([td("Total tax"), td(""), td(""), td(money(invoice.total_tax), true)]),
    row([td("Invoice total"), td(""), td(""), td(money(invoice.invoice_total), true)], "total"),
  ].join("");

  const meta = [
    `Invoice no. ${number ?? "not yet numbered"}`,
    `date ${invoice.invoice_date}`,
    `booking ${subject.bookingId}`,
    `place of supply ${invoice.place_of_supply.state_name} (${invoice.place_of_supply.state_code})`,
    invoice.supply_type === "INTER_STATE" ? "inter-state supply" : "intra-state supply",
  ].join(" · ");

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>` +
    `<h1>Tax Invoice</h1>` +
    `<div class="meta">${escapeHtml(meta)}</div>` +
    `<div class="parties">` +
    party("Supplier", subject.supplierName, invoice.supplier.gstin, invoice.supplier.state_name, subject.supplierCity) +
    party("Bill to", subject.recipientName, invoice.recipient.gstin, invoice.recipient.state_name) +
    `</div>` +
    `<table>${lines}</table>` +
    `<p class="note">Amounts in ${escapeHtml(invoice.currency)}. Tax payable on reverse charge: No.${number ? "" : " This invoice is numbered when issued in the supplier's series."}</p>` +
    `</body></html>`;
  return { html, sha256: sha256(html), invoiceNumber: number };
}
