/**
 * Tally Prime import XML for confirmed bookings: one accounting voucher per
 * expense receipt (lib/finance/receipt.ts), inside Tally's Import Data
 * envelope, so finance can import a period's events in one file
 * (Gateway of Tally → Import → Transactions). Pure: tests/finance/tally.test.mjs
 * imports it directly.
 *
 * Each voucher (Purchase by default, or Journal):
 *
 *   Cr  party ledger (the venue)          invoice total, bill-wise as a New Ref
 *   Dr  expense ledger                    taxable value, allocated to the cost centre
 *   Dr  GST, by the booking's ITC status (lib/finance/itc.ts):
 *         eligible                        Input CGST + Input SGST, or Input IGST
 *         review / awaiting invoice       the ITC-pending ledger, until finance decides
 *         blocked / not eligible / none   added to the expense: blocked credit is cost
 *   Dr/Cr round off                       only if the lines don't already balance
 *
 * Amounts follow Tally's sign convention: debits negative with
 * ISDEEMEDPOSITIVE Yes, credits positive with No. Lines are summed in paise.
 * REMOTEID is stable per booking and event, so re-importing a voucher alters
 * it in Tally instead of creating a duplicate.
 *
 * Ledger, cost category and company names must match the books they're imported
 * into: pass them as options (the API takes them as query parameters).
 */
import type { ExpenseReceipt } from "./receipt.ts";

export const TALLY_VOUCHER_TYPES = ["Purchase", "Journal"] as const;
export type TallyVoucherType = (typeof TALLY_VOUCHER_TYPES)[number];

export interface TallyLedgers {
  /** Where the event's cost is booked. */
  expense: string;
  cgst: string;
  sgst: string;
  igst: string;
  /** Holds GST whose credit finance hasn't decided yet. */
  itcPending: string;
  roundOff: string;
}

export const DEFAULT_TALLY_LEDGERS: TallyLedgers = {
  expense: "Corporate Events & Hospitality",
  cgst: "Input CGST",
  sgst: "Input SGST",
  igst: "Input IGST",
  itcPending: "GST ITC Pending Review",
  roundOff: "Round Off",
};

/** Tally's default cost category; cost centres are allocated under it. */
export const DEFAULT_COST_CATEGORY = "Primary Cost Category";

export interface TallyOptions {
  voucherType?: TallyVoucherType;
  /** The Tally company to import into (SVCURRENTCOMPANY); omit to use the one that's open. */
  companyName?: string | null;
  ledgers?: Partial<TallyLedgers>;
  costCategory?: string;
}

/** One ledger line. Paise, signed as Tally signs them: debit < 0, credit > 0. */
export interface TallyEntry {
  ledger: string;
  amountPaise: number;
  isParty?: boolean;
  costCentre?: string;
  /** Bill-wise reference on the party line. */
  billRef?: string;
}

/** INR → paise, exact for the 2-decimal amounts the GST engine produces. */
const paise = (inr: number) => Math.round(inr * 100);

/** "LUF-BBBBBBBB": the booking's short reference, as the app and invoices show it. */
export const tallyBillRef = (r: ExpenseReceipt) => `LUF-${r.booking.id.slice(0, 8).toUpperCase()}`;

/** Stable per booking and event: a re-import alters the voucher instead of duplicating it. */
export const tallyRemoteId = (r: ExpenseReceipt) => `lufer:${r.event}:${r.booking.id}`;

/** The voucher's ledger lines, balanced to zero. */
export function tallyEntries(r: ExpenseReceipt, opts: TallyOptions = {}): TallyEntry[] {
  const L = { ...DEFAULT_TALLY_LEDGERS, ...opts.ledgers };
  const costCentre = r.expense.cost_center ?? undefined;
  const tax = { cgst: paise(r.tax.cgst), sgst: paise(r.tax.sgst), igst: paise(r.tax.igst) };
  const totalTax = tax.cgst + tax.sgst + tax.igst;

  const debits: TallyEntry[] = [];
  let expense = paise(r.tax.taxable_value);
  switch (r.tax.itc_status) {
    case "eligible":
      if (tax.cgst) debits.push({ ledger: L.cgst, amountPaise: -tax.cgst });
      if (tax.sgst) debits.push({ ledger: L.sgst, amountPaise: -tax.sgst });
      if (tax.igst) debits.push({ ledger: L.igst, amountPaise: -tax.igst });
      break;
    case "review":
    case "awaiting_invoice":
      if (totalTax) debits.push({ ledger: L.itcPending, amountPaise: -totalTax });
      break;
    default:
      // Blocked or never claimable: the GST is part of what the event cost.
      expense += totalTax;
  }
  debits.unshift({ ledger: L.expense, amountPaise: -expense, ...(costCentre && { costCentre }) });

  const party: TallyEntry = { ledger: r.supplier.name, amountPaise: paise(r.tax.invoice_total), isParty: true, billRef: tallyBillRef(r) };
  const entries = [party, ...debits];
  const imbalance = entries.reduce((s, e) => s + e.amountPaise, 0);
  // The engine's totals add up to the paisa; this only guards against a receipt that doesn't.
  if (imbalance !== 0) entries.push({ ledger: L.roundOff, amountPaise: -imbalance });
  return entries;
}

// ----------------------------------------------------------------------------
// XML
// ----------------------------------------------------------------------------

/** Escapes text for XML and drops control characters Tally refuses. */
export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const tag = (name: string, value: string | number) => `<${name}>${xmlEscape(String(value))}</${name}>`;
const amount = (p: number) => (p / 100).toFixed(2);
/** YYYY-MM-DD → YYYYMMDD, as Tally dates are written. */
export const tallyDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const yesNo = (b: boolean) => (b ? "Yes" : "No");

function entryXml(e: TallyEntry, costCategory: string, indent: string): string {
  const i = `${indent}  `;
  const lines = [
    `${indent}<ALLLEDGERENTRIES.LIST>`,
    `${i}${tag("LEDGERNAME", e.ledger)}`,
    `${i}${tag("ISDEEMEDPOSITIVE", yesNo(e.amountPaise < 0))}`,
    `${i}${tag("ISPARTYLEDGER", yesNo(Boolean(e.isParty)))}`,
    `${i}${tag("AMOUNT", amount(e.amountPaise))}`,
  ];
  if (e.billRef) {
    lines.push(`${i}<BILLALLOCATIONS.LIST>`, `${i}  ${tag("NAME", e.billRef)}`, `${i}  ${tag("BILLTYPE", "New Ref")}`, `${i}  ${tag("AMOUNT", amount(e.amountPaise))}`, `${i}</BILLALLOCATIONS.LIST>`);
  }
  if (e.costCentre) {
    lines.push(
      `${i}<CATEGORYALLOCATIONS.LIST>`,
      `${i}  ${tag("CATEGORY", costCategory)}`,
      `${i}  ${tag("ISDEEMEDPOSITIVE", yesNo(e.amountPaise < 0))}`,
      `${i}  <COSTCENTREALLOCATIONS.LIST>`,
      `${i}    ${tag("NAME", e.costCentre)}`,
      `${i}    ${tag("AMOUNT", amount(e.amountPaise))}`,
      `${i}  </COSTCENTREALLOCATIONS.LIST>`,
      `${i}</CATEGORYALLOCATIONS.LIST>`
    );
  }
  lines.push(`${indent}</ALLLEDGERENTRIES.LIST>`);
  return lines.join("\n");
}

/** What the voucher is for, as finance reads it in Tally's day book. */
export function tallyNarration(r: ExpenseReceipt): string {
  return [
    `Corporate event at ${r.supplier.name}, ${r.supplier.city}`,
    `${r.booking.event_date}, ${r.amounts.party_size} guests`,
    `SAC ${r.tax.sac_code}`,
    `ITC: ${r.tax.itc_status.replace(/_/g, " ")}`,
    ...(r.expense.project_code ? [`Project ${r.expense.project_code}`] : []),
    `Lufer ${tallyBillRef(r)}`,
  ].join(" · ");
}

/** One <VOUCHER>, indented for a TALLYMESSAGE. */
export function tallyVoucher(r: ExpenseReceipt, opts: TallyOptions = {}): string {
  const type = opts.voucherType ?? "Purchase";
  const costCategory = opts.costCategory || DEFAULT_COST_CATEGORY;
  const date = tallyDate(r.booking.event_date);
  const state = r.buyer.place_of_supply.replace(/^\d+\s*/, "");
  const i = "            ";
  return [
    `          <VOUCHER REMOTEID="${xmlEscape(tallyRemoteId(r))}" VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `${i}${tag("DATE", date)}`,
    `${i}${tag("EFFECTIVEDATE", date)}`,
    `${i}${tag("VOUCHERTYPENAME", type)}`,
    `${i}${tag("REFERENCE", tallyBillRef(r))}`,
    `${i}${tag("REFERENCEDATE", date)}`,
    `${i}${tag("PARTYLEDGERNAME", r.supplier.name)}`,
    `${i}${tag("PARTYNAME", r.supplier.name)}`,
    `${i}${tag("PARTYGSTIN", r.supplier.gstin)}`,
    `${i}${tag("GSTREGISTRATIONTYPE", "Regular")}`,
    `${i}${tag("CMPGSTIN", r.buyer.billed_gstin)}`,
    `${i}${tag("PLACEOFSUPPLY", state)}`,
    `${i}${tag("PERSISTEDVIEW", "Accounting Voucher View")}`,
    `${i}${tag("ISINVOICE", "No")}`,
    `${i}${tag("NARRATION", tallyNarration(r))}`,
    ...tallyEntries(r, opts).map((e) => entryXml(e, costCategory, i)),
    `          </VOUCHER>`,
  ].join("\n");
}

/** The import file: every voucher in one Import Data envelope. */
export function tallyEnvelope(receipts: readonly ExpenseReceipt[], opts: TallyOptions = {}): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ENVELOPE>`,
    `  <HEADER>`,
    `    ${tag("TALLYREQUEST", "Import Data")}`,
    `  </HEADER>`,
    `  <BODY>`,
    `    <IMPORTDATA>`,
    `      <REQUESTDESC>`,
    `        ${tag("REPORTNAME", "Vouchers")}`,
    ...(opts.companyName ? [`        <STATICVARIABLES>`, `          ${tag("SVCURRENTCOMPANY", opts.companyName)}`, `        </STATICVARIABLES>`] : []),
    `      </REQUESTDESC>`,
    `      <REQUESTDATA>`,
    ...receipts.map((r) => [`        <TALLYMESSAGE xmlns:UDF="TallyUDF">`, tallyVoucher(r, opts), `        </TALLYMESSAGE>`].join("\n")),
    `      </REQUESTDATA>`,
    `    </IMPORTDATA>`,
    `  </BODY>`,
    `</ENVELOPE>`,
    "",
  ].join("\n");
}
