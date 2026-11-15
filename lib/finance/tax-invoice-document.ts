/**
 * A booking's billing documents: the GST tax invoice (the gst-engine's
 * TaxInvoicePayload), the receipt voucher for a deposit, the refund voucher
 * when a deposit goes back, and the payment receipt for the balance.
 *
 * Each is built as a BillDocument (plain text: parties, a table, notes) and
 * then rendered twice from that one model: a self-contained, print-ready HTML
 * page here, and a PDF in lib/finance/document-pdf.ts. The HTML carries a
 * SHA-256 so finance can verify a copy. Deterministic: the same subject
 * renders to the same bytes, so re-running a job is a no-op.
 *
 * Every interpolated value is HTML-escaped.
 *
 * Pure: tests import it directly (tests/finance/durable-jobs.test.mjs).
 */

import type { TaxInvoicePayload } from "../gst-engine.ts";
import { escapeHtml, sha256 } from "../services/contracts/render.ts";
import { amountInWords } from "./amount-words.ts";

export interface BillDocument {
  kind: "tax_invoice" | "receipt_voucher" | "refund_voucher" | "payment_receipt";
  /** The heading, e.g. "Tax Invoice". */
  heading: string;
  /** The page/file title, e.g. "Tax Invoice 2026-27/000001". */
  title: string;
  /** Number, date, booking, place of supply: one line, joined with " · ". */
  meta: string[];
  /** Supplier, then the company. */
  parties: { heading: string; lines: string[] }[];
  columns: { label: string; num?: boolean }[];
  rows: { cells: string[]; total?: boolean }[];
  /** "Rupees … Only" for the document's main amount (null: none). */
  words: string | null;
  notes: string[];
  /** "For <supplier>", above "Authorised signatory" (null: unsigned draft). */
  signFor: string | null;
  footer: string | null;
}

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
  .words { margin: .75rem 0 0; }
  .note { color: #57534e; font-size: 12px; margin-top: 1.5rem; }
  .sign { margin-top: 2.5rem; text-align: right; }
  @page { margin: 18mm; }
  @media print { body { margin: 0 auto; } }
`;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => inr.format(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

function party(heading: string, name: string, gstin: string, state: string, city: string | null = null, address: string | null = null): BillDocument["parties"][number] {
  return { heading, lines: [name, address, address ? null : city, `GSTIN ${gstin}`, `State: ${state}`].filter((l): l is string => Boolean(l)) };
}

const placeOfSupply = (invoice: TaxInvoicePayload) => `place of supply ${invoice.place_of_supply.state_name} (${invoice.place_of_supply.state_code})`;

/** The model as an HTML page. Same model → same bytes. */
export function documentHtml(doc: BillDocument): string {
  const head = `<tr>${doc.columns.map((c) => `<th${c.num ? ' class="num"' : ""}>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const body = doc.rows
    .map((r) => `<tr${r.total ? ' class="total"' : ""}>${r.cells.map((cell, i) => `<td${doc.columns[i]?.num ? ' class="num"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(doc.title)}</title><style>${STYLE}</style></head><body>` +
    `<h1>${escapeHtml(doc.heading)}</h1>` +
    `<div class="meta">${escapeHtml(doc.meta.join(" · "))}</div>` +
    `<div class="parties">` +
    doc.parties.map((p) => `<div><h2>${escapeHtml(p.heading)}</h2>${p.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}</div>`).join("") +
    `</div>` +
    `<table>${head}${body}</table>` +
    (doc.words ? `<p class="words">Amount in words: ${escapeHtml(doc.words)}</p>` : "") +
    doc.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join("") +
    (doc.signFor ? `<p class="sign">For ${escapeHtml(doc.signFor)}<br>Authorised signatory</p>` : "") +
    (doc.footer ? `<p class="note">${escapeHtml(doc.footer)}</p>` : "") +
    `</body></html>`
  );
}

const rendered = (model: BillDocument) => {
  const html = documentHtml(model);
  return { html, sha256: sha256(html), model };
};

// ----------------------------------------------------------------------------
// Tax invoice
// ----------------------------------------------------------------------------

export function taxInvoiceModel(subject: TaxInvoiceSubject): BillDocument {
  const { invoice } = subject;
  const number = invoice.invoice_number;
  const heads =
    invoice.gst_type === "IGST"
      ? [["IGST", invoice.tax_breakup.igst] as const]
      : [["CGST", invoice.tax_breakup.cgst] as const, ["SGST", invoice.tax_breakup.sgst] as const];
  const advance = subject.advance && subject.advance.amount > 0 ? subject.advance : null;
  const balance = advance ? Math.max(0, round2(invoice.invoice_total - advance.amount)) : null;

  return {
    kind: "tax_invoice",
    heading: "Tax Invoice",
    title: number ? `Tax Invoice ${number}` : `Tax Invoice · booking ${subject.bookingId.slice(0, 8)}`,
    meta: [
      `Invoice no. ${number ?? "not yet numbered"}`,
      `date ${invoice.invoice_date}`,
      `booking ${subject.bookingId}`,
      placeOfSupply(invoice),
      invoice.supply_type === "INTER_STATE" ? "inter-state supply" : "intra-state supply",
    ],
    parties: [
      party("Supplier", subject.supplierName, invoice.supplier.gstin, invoice.supplier.state_name, subject.supplierCity, subject.supplierAddress ?? null),
      party("Bill to", subject.recipientName, invoice.recipient.gstin, invoice.recipient.state_name, null, subject.recipientAddress ?? null),
    ],
    columns: [{ label: "Description" }, { label: invoice.tax.kind }, { label: "Qty", num: true }, { label: "Amount", num: true }],
    rows: [
      { cells: [`${invoice.sac.description} · event on ${subject.eventDate}`, invoice.sac.code, String(subject.partySize), money(invoice.taxable_value)] },
      { cells: ["Taxable value", "", "", money(invoice.taxable_value)] },
      ...heads.map(([head, tax]) => ({ cells: [`${head} @ ${tax.rate_percent}%`, "", "", money(tax.amount)] })),
      { cells: ["Total tax", "", "", money(invoice.total_tax)] },
      { cells: ["Invoice total", "", "", money(invoice.invoice_total)], total: true },
      ...(advance
        ? [
            { cells: [`Less: advance received${advance.voucherNumber ? ` (receipt voucher ${advance.voucherNumber})` : ""}`, "", "", `− ${money(advance.amount)}`] },
            { cells: ["Balance payable", "", "", money(balance!)], total: true },
          ]
        : []),
    ],
    words: number ? amountInWords(invoice.invoice_total) : null,
    notes: [`Amounts in ${invoice.currency}. Tax payable on reverse charge: No.${number ? "" : " This invoice is numbered when issued in the supplier's series."}`],
    signFor: number ? subject.supplierName : null,
    footer: number ? "Computer-generated invoice." : null,
  };
}

/** The invoice document. Same subject → same bytes → same hash. */
export function renderTaxInvoice(subject: TaxInvoiceSubject): { html: string; sha256: string; model: BillDocument; invoiceNumber: string | null } {
  return { ...rendered(taxInvoiceModel(subject)), invoiceNumber: subject.invoice.invoice_number };
}

// ----------------------------------------------------------------------------
// Receipt voucher (deposit received) and refund voucher (deposit returned)
// ----------------------------------------------------------------------------

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

type Split = ReceiptVoucherSubject["received"];

function splitHeads(invoice: TaxInvoicePayload, split: Split): (readonly [string, number])[] {
  const half = invoice.tax.rate_percent / 2;
  return invoice.gst_type === "IGST"
    ? [[`IGST @ ${invoice.tax.rate_percent}%`, split.igst] as const]
    : [[`CGST @ ${half}%`, split.cgst] as const, [`SGST @ ${half}%`, split.sgst] as const];
}

export function receiptVoucherModel(v: ReceiptVoucherSubject): BillDocument {
  const { invoice, received } = v;
  return {
    kind: "receipt_voucher",
    heading: "Receipt Voucher",
    title: `Receipt Voucher ${v.voucherNumber}`,
    meta: [`Voucher no. ${v.voucherNumber}`, `date ${v.issuedOn}`, `booking ${v.bookingId}`, placeOfSupply(invoice), ...(v.paymentRef ? [`payment ${v.paymentRef}`] : [])],
    parties: [
      party("Supplier", v.supplierName, invoice.supplier.gstin, invoice.supplier.state_name, v.supplierCity, v.supplierAddress),
      party("Received from", v.recipientName, invoice.recipient.gstin, invoice.recipient.state_name, null, v.recipientAddress),
    ],
    columns: [{ label: "Description" }, { label: invoice.tax.kind }, { label: "Amount", num: true }],
    rows: [
      { cells: [`Advance for ${invoice.sac.description} · event on ${v.eventDate} · ${v.partySize} guests`, invoice.sac.code, money(received.taxable)] },
      ...splitHeads(invoice, received).map(([label, amount]) => ({ cells: [label, "", money(amount)] })),
      { cells: ["Amount received", "", money(received.total)], total: true },
    ],
    words: amountInWords(received.total),
    notes: [`Advance received against a supply of services not yet made; the tax invoice follows after the event and sets this amount against it. Amounts in ${invoice.currency}. Tax payable on reverse charge: No.`],
    signFor: v.supplierName,
    footer: "Computer-generated receipt voucher.",
  };
}

/** A receipt voucher for an advance (the deposit). Same subject → same bytes → same hash. */
export function renderReceiptVoucher(v: ReceiptVoucherSubject): { html: string; sha256: string; model: BillDocument } {
  return rendered(receiptVoucherModel(v));
}

export interface RefundVoucherSubject {
  voucherNumber: string;
  issuedOn: string;
  bookingId: string;
  eventDate: string;
  supplierName: string;
  supplierCity: string | null;
  supplierAddress: string | null;
  recipientName: string;
  recipientAddress: string | null;
  invoice: TaxInvoicePayload;
  /** Amount refunded, GST included, and its split. */
  refunded: Split;
  /** The receipt voucher the advance was acknowledged with, when there is one. */
  receiptVoucherNumber: string | null;
  /** The provider's refund reference (rfnd_…). */
  refundRef: string | null;
}

export function refundVoucherModel(v: RefundVoucherSubject): BillDocument {
  const { invoice, refunded } = v;
  return {
    kind: "refund_voucher",
    heading: "Refund Voucher",
    title: `Refund Voucher ${v.voucherNumber}`,
    meta: [`Voucher no. ${v.voucherNumber}`, `date ${v.issuedOn}`, `booking ${v.bookingId}`, placeOfSupply(invoice), ...(v.refundRef ? [`refund ${v.refundRef}`] : [])],
    parties: [
      party("Supplier", v.supplierName, invoice.supplier.gstin, invoice.supplier.state_name, v.supplierCity, v.supplierAddress),
      party("Refunded to", v.recipientName, invoice.recipient.gstin, invoice.recipient.state_name, null, v.recipientAddress),
    ],
    columns: [{ label: "Description" }, { label: invoice.tax.kind }, { label: "Amount", num: true }],
    rows: [
      {
        cells: [
          `Refund of advance for ${invoice.sac.description} · event on ${v.eventDate}${v.receiptVoucherNumber ? ` · receipt voucher ${v.receiptVoucherNumber}` : ""}`,
          invoice.sac.code,
          money(refunded.taxable),
        ],
      },
      ...splitHeads(invoice, refunded).map(([label, amount]) => ({ cells: [label, "", money(amount)] })),
      { cells: ["Amount refunded", "", money(refunded.total)], total: true },
    ],
    words: amountInWords(refunded.total),
    notes: [`Advance refunded: the supply was not made and no tax invoice was issued for this amount. Amounts in ${invoice.currency}. Tax payable on reverse charge: No.`],
    signFor: v.supplierName,
    footer: "Computer-generated refund voucher.",
  };
}

/** A refund voucher for an advance returned before any invoice. Same subject → same bytes → same hash. */
export function renderRefundVoucher(v: RefundVoucherSubject): { html: string; sha256: string; model: BillDocument } {
  return rendered(refundVoucherModel(v));
}

// ----------------------------------------------------------------------------
// Payment receipt (balance paid against an issued invoice)
// ----------------------------------------------------------------------------

export interface PaymentReceiptSubject {
  invoiceNumber: string;
  invoiceDate: string;
  /** Day the payment was captured (IST). */
  paidOn: string;
  bookingId: string;
  eventDate: string;
  supplierName: string;
  supplierCity: string | null;
  supplierAddress: string | null;
  recipientName: string;
  recipientAddress: string | null;
  invoice: TaxInvoicePayload;
  /** Deposit set against the invoice when it was issued. */
  advance: number;
  /** This payment. */
  paid: number;
  paymentRef: string | null;
}

/** Not a GST document: the tax is on the invoice. It acknowledges money against it. */
export function paymentReceiptModel(r: PaymentReceiptSubject): BillDocument {
  const { invoice } = r;
  const outstanding = Math.max(0, round2(invoice.invoice_total - r.advance - r.paid));
  return {
    kind: "payment_receipt",
    heading: "Payment Receipt",
    title: `Payment Receipt · invoice ${r.invoiceNumber}`,
    meta: [`Against tax invoice ${r.invoiceNumber} dated ${r.invoiceDate}`, `received ${r.paidOn}`, `booking ${r.bookingId}`, ...(r.paymentRef ? [`payment ${r.paymentRef}`] : [])],
    parties: [
      party("Supplier", r.supplierName, invoice.supplier.gstin, invoice.supplier.state_name, r.supplierCity, r.supplierAddress),
      party("Received from", r.recipientName, invoice.recipient.gstin, invoice.recipient.state_name, null, r.recipientAddress),
    ],
    columns: [{ label: "Description" }, { label: "Amount", num: true }],
    rows: [
      { cells: [`Invoice total · event on ${r.eventDate}`, money(invoice.invoice_total)] },
      ...(r.advance > 0 ? [{ cells: ["Less: advance received", `− ${money(r.advance)}`] }] : []),
      { cells: ["Amount received", money(r.paid)], total: true },
      { cells: [outstanding > 0 ? "Still payable" : "Balance", outstanding > 0 ? money(outstanding) : "Paid in full"] },
    ],
    words: amountInWords(r.paid),
    notes: [`Receipt for payment against the tax invoice above; the GST is charged on that invoice. Amounts in ${invoice.currency}.`],
    signFor: r.supplierName,
    footer: "Computer-generated receipt.",
  };
}

export function renderPaymentReceipt(r: PaymentReceiptSubject): { html: string; sha256: string; model: BillDocument } {
  return rendered(paymentReceiptModel(r));
}
