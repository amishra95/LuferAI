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
  /** The venue's address (venues.address). */
  supplierAddress?: string | null;
  recipientName: string;
  /** The company's billing address (companies.billing_address). */
  recipientAddress?: string | null;
  invoice: TaxInvoicePayload;
  /** A deposit already received against this supply, and its receipt voucher. */
  advance?: { amount: number; voucherNumber: string | null } | null;
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
  .sign { margin-top: 2.5rem; text-align: right; }
  @page { margin: 18mm; }
  @media print { body { margin: 0 auto; } }
`;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => escapeHtml(inr.format(n));
const row = (cells: string[], cls = "") => `<tr${cls ? ` class="${cls}"` : ""}>${cells.join("")}</tr>`;
const td = (text: string, num = false) => `<td${num ? ' class="num"' : ""}>${text}</td>`;

function party(heading: string, name: string, gstin: string, state: string, city: string | null = null, address: string | null = null): string {
  const lines = [name, address, address ? null : city, `GSTIN ${gstin}`, `State: ${state}`].filter((l): l is string => Boolean(l));
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
    ...(subject.advance && subject.advance.amount > 0
      ? [
          row([td(escapeHtml(`Less: advance received${subject.advance.voucherNumber ? ` (receipt voucher ${subject.advance.voucherNumber})` : ""}`)), td(""), td(""), td(`− ${money(subject.advance.amount)}`, true)]),
          row([td("Balance payable"), td(""), td(""), td(money(Math.max(0, Math.round((invoice.invoice_total - subject.advance.amount) * 100) / 100)), true)], "total"),
        ]
      : []),
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
    party("Supplier", subject.supplierName, invoice.supplier.gstin, invoice.supplier.state_name, subject.supplierCity, subject.supplierAddress ?? null) +
    party("Bill to", subject.recipientName, invoice.recipient.gstin, invoice.recipient.state_name, null, subject.recipientAddress ?? null) +
    `</div>` +
    `<table>${lines}</table>` +
    `<p class="note">Amounts in ${escapeHtml(invoice.currency)}. Tax payable on reverse charge: No.${number ? "" : " This invoice is numbered when issued in the supplier's series."}</p>` +
    (number ? `<p class="sign">For ${escapeHtml(subject.supplierName)}<br>Authorised signatory</p><p class="note">Computer-generated invoice.</p>` : "") +
    `</body></html>`;
  return { html, sha256: sha256(html), invoiceNumber: number };
}

export interface ReceiptVoucherSubject {
  voucherNumber: string;
  issuedOn: string;
  bookingId: string;
  eventDate: string;
  partySize: number;
  supplierName: string;
  supplierCity: string | null;
  supplierAddress: string | null;
  recipientName: string;
  recipientAddress: string | null;
  /** The booking's GST snapshot: parties, SAC, rate and place of supply. */
  invoice: TaxInvoicePayload;
  /** Amount received, GST included, and its split (lib/finance/billing-rules.ts splitInclusive). */
  received: { total: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number };
  paymentRef: string | null;
}

/** A receipt voucher for an advance (the deposit). Same subject → same bytes → same hash. */
export function renderReceiptVoucher(v: ReceiptVoucherSubject): { html: string; sha256: string } {
  const { invoice, received } = v;
  const half = invoice.tax.rate_percent / 2;
  const heads =
    invoice.gst_type === "IGST"
      ? [[`IGST @ ${invoice.tax.rate_percent}%`, received.igst] as const]
      : [[`CGST @ ${half}%`, received.cgst] as const, [`SGST @ ${half}%`, received.sgst] as const];
  const lines = [
    row([`<th>Description</th>`, `<th>${escapeHtml(invoice.tax.kind)}</th>`, `<th class="num">Amount</th>`]),
    row([td(escapeHtml(`Advance for ${invoice.sac.description} · event on ${v.eventDate} · ${v.partySize} guests`)), td(escapeHtml(invoice.sac.code)), td(money(received.taxable), true)]),
    ...heads.map(([label, amount]) => row([td(escapeHtml(label)), td(""), td(money(amount), true)])),
    row([td("Amount received"), td(""), td(money(received.total), true)], "total"),
  ].join("");
  const meta = [
    `Voucher no. ${v.voucherNumber}`,
    `date ${v.issuedOn}`,
    `booking ${v.bookingId}`,
    `place of supply ${invoice.place_of_supply.state_name} (${invoice.place_of_supply.state_code})`,
    ...(v.paymentRef ? [`payment ${v.paymentRef}`] : []),
  ].join(" · ");
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(`Receipt Voucher ${v.voucherNumber}`)}</title><style>${STYLE}</style></head><body>` +
    `<h1>Receipt Voucher</h1>` +
    `<div class="meta">${escapeHtml(meta)}</div>` +
    `<div class="parties">` +
    party("Supplier", v.supplierName, invoice.supplier.gstin, invoice.supplier.state_name, v.supplierCity, v.supplierAddress) +
    party("Received from", v.recipientName, invoice.recipient.gstin, invoice.recipient.state_name, null, v.recipientAddress) +
    `</div>` +
    `<table>${lines}</table>` +
    `<p class="note">Advance received against a supply of services not yet made; the tax invoice follows after the event and sets this amount against it. Amounts in ${escapeHtml(invoice.currency)}. Tax payable on reverse charge: No.</p>` +
    `<p class="sign">For ${escapeHtml(v.supplierName)}<br>Authorised signatory</p><p class="note">Computer-generated receipt voucher.</p>` +
    `</body></html>`;
  return { html, sha256: sha256(html) };
}
