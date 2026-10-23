/**
 * A booking's settlement trail, assembled from the records that already exist
 * (approvals, venue acceptance, payments, tax invoices, expense/ERP exports,
 * the ITC decision, settlement) rather than a separate audit table, so it can
 * never disagree with them. Pure, so tests/finance/settlement.test.mjs can use it.
 */
import { PROVIDER_LABEL, isExpenseProvider } from "./expense-adapters.ts";

/** The booking's line on its blanket PO, e.g. "PO-2026-014/L3". */
export const poLineRef = (poNumber: string, line: number | null) => (line ? `${poNumber}/L${line}` : poNumber);

export type SettlementTone = "ok" | "warn" | "error" | "neutral";

export interface SettlementEvent {
  at: string;
  kind: "request" | "approval" | "venue" | "payment" | "invoice" | "export" | "itc" | "settled";
  label: string;
  detail?: string;
  tone: SettlementTone;
}

export interface SettlementInput {
  booking: {
    created_at: string;
    venue_accepted_at: string | null;
    settled_at: string | null;
    expense_reference: string | null;
    itc_decision: string | null;
    itc_decided_at: string | null;
    itc_note: string | null;
  };
  approvals: { status: string; decided_at: string | null; approver_name: string; decision_note: string | null }[];
  payments: { provider: string; status: string; amount_inr: number; created_at: string; authorized_at: string | null; captured_at: string | null; voided_at: string | null }[];
  invoices: { kind: string; invoice_number: string | null; status: string; total_inr: number; issued_at: string | null; paid_at: string | null }[];
  exports: { provider: string; status: string; attempts: number; error: string | null; created_at: string; updated_at: string; requested_by: string | null }[];
}

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const providerName = (p: string) => (isExpenseProvider(p) ? PROVIDER_LABEL[p] : p);

/** Everything that happened to the booking's money, oldest first. */
export function settlementTimeline(input: SettlementInput): SettlementEvent[] {
  const { booking: b } = input;
  const events: SettlementEvent[] = [{ at: b.created_at, kind: "request", label: "Booking requested", tone: "neutral" }];

  for (const a of input.approvals) {
    if (!a.decided_at) continue;
    const approved = a.status === "APPROVED";
    events.push({ at: a.decided_at, kind: "approval", label: `${approved ? "Approved" : "Rejected"} by ${a.approver_name}`, detail: a.decision_note ?? undefined, tone: approved ? "ok" : "error" });
  }
  if (b.venue_accepted_at) events.push({ at: b.venue_accepted_at, kind: "venue", label: "Venue confirmed", tone: "ok" });

  for (const p of input.payments) {
    const via = `${inr(p.amount_inr)} via ${p.provider}`;
    if (p.authorized_at) events.push({ at: p.authorized_at, kind: "payment", label: "Deposit authorised", detail: via, tone: "neutral" });
    if (p.captured_at) events.push({ at: p.captured_at, kind: "payment", label: "Payment captured", detail: via, tone: "ok" });
    if (p.voided_at) events.push({ at: p.voided_at, kind: "payment", label: "Payment voided", detail: via, tone: "warn" });
  }

  for (const i of input.invoices) {
    const what = `${i.kind === "deposit" ? "Deposit" : "Balance"} invoice${i.invoice_number ? ` ${i.invoice_number}` : ""}`;
    if (i.issued_at) events.push({ at: i.issued_at, kind: "invoice", label: `${what} issued`, detail: inr(i.total_inr), tone: "neutral" });
    if (i.paid_at) events.push({ at: i.paid_at, kind: "invoice", label: `${what} paid`, detail: inr(i.total_inr), tone: "ok" });
  }

  for (const e of input.exports) {
    const name = providerName(e.provider);
    const by = e.requested_by ? "sent by hand" : "sent on confirmation";
    const attempts = e.attempts > 1 ? ` after ${e.attempts} attempts` : "";
    if (e.status === "failed") events.push({ at: e.updated_at, kind: "export", label: `Export to ${name} failed`, detail: e.error ?? undefined, tone: "error" });
    else if (e.status === "dead_lettered")
      events.push({ at: e.updated_at, kind: "export", label: `Export to ${name} gave up${attempts}`, detail: [e.error, "export again to retry"].filter(Boolean).join(" · "), tone: "error" });
    else events.push({ at: e.updated_at, kind: "export", label: `${e.status === "mocked" ? "Recorded for" : "Exported to"} ${name}`, detail: `${by}${attempts}${e.status === "mocked" ? " (no endpoint configured)" : ""}`, tone: e.status === "mocked" ? "warn" : "ok" });
  }

  if (b.itc_decision && b.itc_decided_at) {
    events.push({
      at: b.itc_decided_at,
      kind: "itc",
      label: b.itc_decision === "eligible" ? "ITC confirmed eligible" : "ITC marked blocked",
      detail: b.itc_note ?? undefined,
      tone: b.itc_decision === "eligible" ? "ok" : "warn",
    });
  }
  if (b.settled_at) events.push({ at: b.settled_at, kind: "settled", label: "Settled", detail: b.expense_reference ?? undefined, tone: "ok" });

  return events.sort((x, y) => x.at.localeCompare(y.at));
}
