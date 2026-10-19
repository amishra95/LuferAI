/**
 * The payment schedule an executed contract creates (migration 0031): a
 * deposit due on execution and the balance due BALANCE_DUE_DAYS before the
 * event, each a GST tax invoice. Tax heads are split in proportion and the
 * balance takes the remainder, so the instalments always add up to the
 * booking's invoice to the paisa.
 *
 * Pure: tests import it directly (tests/contracts.test.mjs).
 */

export const BALANCE_DUE_DAYS = 7;
/** The balance invoice is issued this many days before it falls due. */
export const BALANCE_ISSUE_LEAD_DAYS = 7;

export interface InvoiceTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface PlannedInstalment extends InvoiceTotals {
  kind: "deposit" | "balance";
  sequence: number;
  /** YYYY-MM-DD the invoice is issued (numbered). */
  issueOn: string;
  dueOn: string;
}

const paise = (inr: number) => Math.round(Number((inr * 100).toPrecision(15)));
const inr = (p: number) => p / 100;
const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const later = (a: string, b: string) => (a > b ? a : b);

/** The deposit: the venue's rate of the invoice total, rounded half-up to the paisa (as lib/quotes depositFor). */
export const depositTotal = (invoiceTotal: number, rate: number) => inr(Math.round(paise(invoiceTotal) * rate));

/**
 * Splits the booking's invoice into deposit and balance. `depositInr` overrides the
 * deposit (a deposit already authorised before the contract); a deposit covering
 * the whole invoice leaves no balance instalment.
 */
export function planInstalments(opts: {
  invoice: InvoiceTotals;
  depositRate: number;
  eventDate: string;
  /** YYYY-MM-DD (IST) the contract executed. */
  today: string;
  depositInr?: number;
}): PlannedInstalment[] {
  const total = paise(opts.invoice.total);
  const deposit = Math.min(total, paise(opts.depositInr ?? depositTotal(opts.invoice.total, opts.depositRate)));
  if (deposit <= 0) throw new Error("The deposit must be more than ₹0");

  const heads = { cgst: paise(opts.invoice.cgst), sgst: paise(opts.invoice.sgst), igst: paise(opts.invoice.igst) };
  const share = (p: number) => Math.round((p * deposit) / total);
  const dep = { cgst: share(heads.cgst), sgst: share(heads.sgst), igst: share(heads.igst) };
  const depTaxable = deposit - dep.cgst - dep.sgst - dep.igst;

  const out: PlannedInstalment[] = [
    { kind: "deposit", sequence: 1, taxable: inr(depTaxable), cgst: inr(dep.cgst), sgst: inr(dep.sgst), igst: inr(dep.igst), total: inr(deposit), issueOn: opts.today, dueOn: opts.today },
  ];
  if (deposit < total) {
    const bal = { cgst: heads.cgst - dep.cgst, sgst: heads.sgst - dep.sgst, igst: heads.igst - dep.igst };
    const dueOn = later(addDays(opts.eventDate, -BALANCE_DUE_DAYS), opts.today);
    out.push({
      kind: "balance",
      sequence: 2,
      taxable: inr(paise(opts.invoice.taxable) - depTaxable),
      cgst: inr(bal.cgst),
      sgst: inr(bal.sgst),
      igst: inr(bal.igst),
      total: inr(total - deposit),
      issueOn: later(addDays(dueOn, -BALANCE_ISSUE_LEAD_DAYS), opts.today),
      dueOn,
    });
  }
  return out;
}

/** The schedule as the contract states it. */
export function describeSchedule(instalments: readonly PlannedInstalment[]): { kind: "deposit" | "balance"; total: number; due: string }[] {
  return instalments.map((i) => ({ kind: i.kind, total: i.total, due: i.kind === "deposit" ? "on execution" : i.dueOn }));
}

/** Whether an invoice can be paid now, and why not. */
export function payability(invoice: { status: string; total_inr: number }): { ok: true } | { ok: false; reason: string } {
  if (invoice.status === "paid") return { ok: false, reason: "Already paid" };
  if (invoice.status === "void") return { ok: false, reason: "Voided" };
  if (invoice.status === "scheduled") return { ok: false, reason: "Not issued yet" };
  return Number(invoice.total_inr) > 0 ? { ok: true } : { ok: false, reason: "Nothing to pay" };
}
