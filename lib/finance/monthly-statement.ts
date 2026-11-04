/**
 * A company's monthly statement: every confirmed booking whose event fell in the
 * month, across all venues, on one document finance can pay against and file.
 * Each line keeps the venue's own GST tax invoice number (Lufer doesn't re-bill
 * the supply), so the statement is a summary of record plus one balance due,
 * not a new tax invoice.
 *
 * Pure and deterministic: tests import it directly (tests/finance/monthly-statement.test.mjs).
 */

import { escapeHtml, sha256 } from "../services/contracts/render.ts";
import { listedGstin } from "../venues/gstin.ts";

/** Statuses that belong on a statement: confirmed onwards (as for tax invoices). */
export const STATEMENT_STATUSES = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isStatementMonth = (m: string) => MONTH.test(m);

/** "2026-10" → "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The month before `today` (YYYY-MM-DD), as YYYY-MM: what the 1st-of-month run issues. */
export function previousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export interface StatementBooking {
  id: string;
  status: string;
  event_date: string;
  party_size: number;
  cost_center: string | null;
  project_code: string | null;
  venue: { id: string; name: string; city: string | null; gstin: string | null };
  invoice: {
    invoice_number: string | null;
    gst_type: "CGST_SGST" | "IGST";
    taxable_value: number;
    tax_breakup: { cgst: { amount: number }; sgst: { amount: number }; igst: { amount: number } };
    total_tax: number;
    invoice_total: number;
  };
}

/** Money already paid against a booking (captured payments). */
export interface StatementPayment {
  booking_id: string;
  status: string;
  amount_inr: number;
}

export interface StatementLine {
  bookingId: string;
  eventDate: string;
  partySize: number;
  invoiceNumber: string | null;
  costCenter: string | null;
  projectCode: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid: number;
  due: number;
}

export interface StatementVendor {
  venueId: string;
  name: string;
  city: string | null;
  gstin: string;
  lines: StatementLine[];
  taxable: number;
  tax: number;
  total: number;
  due: number;
}

export interface Totals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
}

export interface MonthlyStatement {
  number: string;
  month: string;
  label: string;
  company: { id: string; legal_name: string; gstin: string };
  vendors: StatementVendor[];
  totals: Totals;
  bookingCount: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "ST-202610-1A2B3C4D": the month plus the company id's first 8 characters. Stable across re-runs. */
export const statementNumber = (companyId: string, month: string) => `ST-${month.replace("-", "")}-${companyId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

export function buildMonthlyStatement(input: {
  company: { id: string; legal_name: string; gstin: string };
  month: string;
  bookings: readonly StatementBooking[];
  payments?: readonly StatementPayment[];
}): MonthlyStatement {
  if (!isStatementMonth(input.month)) throw new Error(`Invalid statement month: ${input.month}`);
  const paid = new Map<string, number>();
  for (const p of input.payments ?? []) if (p.status === "captured") paid.set(p.booking_id, (paid.get(p.booking_id) ?? 0) + Number(p.amount_inr));

  const vendors = new Map<string, StatementVendor>();
  const totals: Totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0, paid: 0, due: 0 };
  let count = 0;

  const inMonth = input.bookings
    .filter((b) => STATEMENT_STATUSES.has(b.status) && b.event_date.startsWith(`${input.month}-`))
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id.localeCompare(b.id));

  for (const b of inMonth) {
    const i = b.invoice;
    const total = r2(i.invoice_total);
    const paidAmt = r2(Math.min(paid.get(b.id) ?? 0, total));
    const line: StatementLine = {
      bookingId: b.id,
      eventDate: b.event_date,
      partySize: b.party_size,
      invoiceNumber: i.invoice_number,
      costCenter: b.cost_center,
      projectCode: b.project_code,
      taxable: r2(i.taxable_value),
      cgst: r2(i.tax_breakup.cgst.amount),
      sgst: r2(i.tax_breakup.sgst.amount),
      igst: r2(i.tax_breakup.igst.amount),
      total,
      paid: paidAmt,
      due: r2(total - paidAmt),
    };
    let v = vendors.get(b.venue.id);
    if (!v) {
      v = { venueId: b.venue.id, name: b.venue.name, city: b.venue.city, gstin: listedGstin(b.venue), lines: [], taxable: 0, tax: 0, total: 0, due: 0 };
      vendors.set(b.venue.id, v);
    }
    v.lines.push(line);
    v.taxable = r2(v.taxable + line.taxable);
    v.tax = r2(v.tax + line.cgst + line.sgst + line.igst);
    v.total = r2(v.total + line.total);
    v.due = r2(v.due + line.due);

    totals.taxable = r2(totals.taxable + line.taxable);
    totals.cgst = r2(totals.cgst + line.cgst);
    totals.sgst = r2(totals.sgst + line.sgst);
    totals.igst = r2(totals.igst + line.igst);
    totals.total = r2(totals.total + line.total);
    totals.paid = r2(totals.paid + line.paid);
    totals.due = r2(totals.due + line.due);
    count++;
  }
  totals.tax = r2(totals.cgst + totals.sgst + totals.igst);

  return {
    number: statementNumber(input.company.id, input.month),
    month: input.month,
    label: monthLabel(input.month),
    company: input.company,
    vendors: [...vendors.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    totals,
    bookingCount: count,
  };
}

// ----------------------------------------------------------------------------
// CSV (one row per booking; what finance imports into its ERP)
// ----------------------------------------------------------------------------

const CSV_HEADER = ["statement", "event_date", "vendor", "vendor_gstin", "vendor_invoice", "booking_id", "guests", "cost_centre", "project_code", "taxable_inr", "cgst_inr", "sgst_inr", "igst_inr", "total_inr", "paid_inr", "due_inr"];

/** Quotes a cell, and defuses spreadsheet formulas (=, +, -, @ at the start). */
function cell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return v.toFixed(2);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) || safe !== v ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function statementCsv(s: MonthlyStatement): string {
  const rows = [CSV_HEADER.join(",")];
  for (const v of s.vendors) {
    for (const l of v.lines) {
      rows.push(
        [s.number, l.eventDate, v.name, v.gstin, l.invoiceNumber, l.bookingId, String(l.partySize), l.costCenter, l.projectCode, l.taxable, l.cgst, l.sgst, l.igst, l.total, l.paid, l.due]
          .map((x) => cell(x as string | number | null))
          .join(","),
      );
    }
  }
  return rows.join("\r\n") + "\r\n";
}

// ----------------------------------------------------------------------------
// HTML (print-ready; browsers save it as PDF)
// ----------------------------------------------------------------------------

const STYLE = `
  :root { color-scheme: light; }
  body { font: 13px/1.5 Georgia, "Times New Roman", serif; color: #1c1917; background: #fff; max-width: 60rem; margin: 2.5rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  h2 { font-size: .95rem; margin: 1.75rem 0 .25rem; }
  .meta, .sub { color: #57534e; font: 12px/1.5 ui-monospace, Menlo, monospace; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; margin: 1.25rem 0; }
  .summary div { border: 1px solid #e7e5e4; padding: .6rem .75rem; }
  .summary b { display: block; font-size: 1.05rem; }
  table { width: 100%; border-collapse: collapse; margin: .35rem 0; }
  th { text-align: left; font-weight: normal; color: #57534e; font-size: 11px; padding: .35rem .25rem; }
  td { border-top: 1px solid #e7e5e4; padding: .35rem .25rem; vertical-align: top; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { border-top: 2px solid #1c1917; font-weight: bold; }
  .note { color: #57534e; font-size: 12px; margin-top: 1.75rem; }
  @page { margin: 14mm; }
`;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => escapeHtml(inr.format(n));
const td = (t: string, num = false) => `<td${num ? ' class="num"' : ""}>${t}</td>`;

export function renderStatementHtml(s: MonthlyStatement): { html: string; sha256: string } {
  const e = escapeHtml;
  const head = `<tr><th>Date</th><th>Vendor invoice</th><th>Booking</th><th>Cost centre</th><th class="num">Guests</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th></tr>`;
  const sections = s.vendors
    .map((v) => {
      const lines = v.lines
        .map((l) =>
          `<tr>${[
            td(e(l.eventDate)),
            td(e(l.invoiceNumber ?? "Pending")),
            td(e(l.bookingId.slice(0, 8))),
            td(e(l.costCenter ?? "—")),
            td(String(l.partySize), true),
            td(money(l.taxable), true),
            td(money(l.cgst + l.sgst + l.igst), true),
            td(money(l.total), true),
            td(money(l.paid), true),
            td(money(l.due), true),
          ].join("")}</tr>`,
        )
        .join("");
      const sub = `<tr class="total">${td("Subtotal")}${td("")}${td("")}${td("")}${td("")}${td(money(v.taxable), true)}${td(money(v.tax), true)}${td(money(v.total), true)}${td(money(v.total - v.due), true)}${td(money(v.due), true)}</tr>`;
      return `<h2>${e(v.name)}</h2><div class="sub">${e([v.city, `GSTIN ${v.gstin}`].filter(Boolean).join(" · "))}</div><table>${head}${lines}${sub}</table>`;
    })
    .join("");

  const t = s.totals;
  const gstSplit = t.igst > 0 && t.cgst + t.sgst > 0 ? `CGST ${money(t.cgst)} · SGST ${money(t.sgst)} · IGST ${money(t.igst)}` : t.igst > 0 ? `IGST ${money(t.igst)}` : `CGST ${money(t.cgst)} · SGST ${money(t.sgst)}`;
  const body = s.bookingCount
    ? `<div class="summary"><div>Bookings<b>${s.bookingCount}</b></div><div>Vendors<b>${s.vendors.length}</b></div><div>Total incl. GST<b>${money(t.total)}</b></div><div>Balance due<b>${money(t.due)}</b></div></div>
       <p class="meta">Taxable ${money(t.taxable)} · ${gstSplit} · Paid ${money(t.paid)}</p>${sections}`
    : `<p>No confirmed bookings had events in ${e(s.label)}.</p>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Statement ${e(s.number)}</title><style>${STYLE}</style></head><body>
<h1>Monthly statement · ${e(s.label)}</h1>
<div class="meta">${e(s.number)} · ${e(s.company.legal_name)} · GSTIN ${e(s.company.gstin)}</div>
${body}
<p class="note">This statement summarises the month's bookings made through Lufer. It is not a tax invoice: each line's GST is charged on the vendor's own tax invoice (the number shown), which is what you claim input tax credit against.</p>
</body></html>`;
  return { html, sha256: sha256(html) };
}
