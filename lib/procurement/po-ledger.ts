/**
 * Blanket purchase orders and the allocation ledger (migration 0020):
 * balances, which PO a booking draws from, and how allocations follow the
 * booking lifecycle. The po_allocations_check trigger enforces the same rules
 * in Postgres; the local stores use these.
 *
 * Pure: tests import it directly (tests/po-ledger.test.mjs).
 */

export type PoStatus = "open" | "closed";
export type AllocationStatus = "committed" | "consumed" | "released";

export interface PoRecord {
  id: string;
  tenant_id: string;
  po_number: string;
  department_id: string | null;
  amount_inr: number;
  valid_from: string;
  valid_to: string;
  status: PoStatus | string;
}

export interface AllocationRecord {
  id: string;
  po_id: string;
  booking_id: string;
  amount_inr: number;
  status: AllocationStatus | string;
  over_balance: boolean;
}

/** The allocation status a booking status implies (bookings_sync_po_allocations). */
export function allocationStatusFor(bookingStatus: string): AllocationStatus {
  if (bookingStatus === "CANCELLED") return "released";
  if (bookingStatus === "COMPLETED" || bookingStatus === "SETTLED") return "consumed";
  return "committed";
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface PoBalance {
  amount: number;
  committed: number;
  consumed: number;
  /** amount − committed − consumed; negative when sign-off allowed an overrun. */
  remaining: number;
  /** Share of the PO drawn, 0–100+ (over 100 once overrun). */
  usedPct: number;
  overrun: boolean;
}

export function poBalance(po: Pick<PoRecord, "id" | "amount_inr">, allocations: readonly AllocationRecord[], excludeBookingId?: string): PoBalance {
  let committed = 0;
  let consumed = 0;
  for (const a of allocations) {
    if (a.po_id !== po.id || a.booking_id === excludeBookingId) continue;
    if (a.status === "committed") committed += Number(a.amount_inr);
    else if (a.status === "consumed") consumed += Number(a.amount_inr);
  }
  const amount = Number(po.amount_inr);
  const remaining = round(amount - committed - consumed);
  return {
    amount,
    committed: round(committed),
    consumed: round(consumed),
    remaining,
    usedPct: amount > 0 ? Math.round(((amount - remaining) / amount) * 1000) / 10 : 0,
    overrun: remaining < 0,
  };
}

export interface PoBookingInput {
  tenantId: string;
  eventDate: string;
  departmentId: string | null;
  /** Pre-GST total the booking commits. */
  amount: number;
  /** A PO the requester picked; otherwise the best eligible one is chosen. */
  poId?: string | null;
  /** When re-allocating, the booking's own current allocation doesn't count against the balance. */
  bookingId?: string;
}

/** Why a PO can't take a booking at all (as opposed to lacking balance), or null. */
export function ineligibility(po: PoRecord, input: Pick<PoBookingInput, "tenantId" | "eventDate" | "departmentId">): string | null {
  if (po.tenant_id !== input.tenantId) return `PO ${po.po_number} belongs to another company`;
  if (po.status !== "open") return `PO ${po.po_number} is closed`;
  if (input.eventDate < po.valid_from || input.eventDate > po.valid_to) return `PO ${po.po_number} is valid ${po.valid_from} to ${po.valid_to}`;
  if (po.department_id && po.department_id !== input.departmentId) return `PO ${po.po_number} is for another department`;
  return null;
}

export type PoSelection =
  /** The company has no POs: nothing to allocate (POs are opt-in per company). */
  | { kind: "none" }
  | { kind: "ok"; po: PoRecord; balance: PoBalance }
  /** The best PO for it, which the booking would overdraw: allowed only with sign-off. */
  | { kind: "over_balance"; po: PoRecord; balance: PoBalance; shortfall: number; reason: string }
  /** POs exist but none can take this booking (wrong department, expired, closed…). */
  | { kind: "ineligible"; reason: string };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Which PO a booking draws from. A chosen PO is used if eligible. Otherwise:
 * department POs before company-wide ones, then the one expiring soonest (use
 * it before it lapses), among those with enough balance; if none has enough,
 * the eligible one with the most left, flagged for sign-off.
 */
export function selectPo(pos: readonly PoRecord[], allocations: readonly AllocationRecord[], input: PoBookingInput): PoSelection {
  const mine = pos.filter((p) => p.tenant_id === input.tenantId);
  if (mine.length === 0) return { kind: "none" };

  const withBalance = (po: PoRecord) => ({ po, balance: poBalance(po, allocations, input.bookingId) });
  const decide = ({ po, balance }: { po: PoRecord; balance: PoBalance }): PoSelection => {
    if (balance.remaining >= input.amount) return { kind: "ok", po, balance };
    const shortfall = round(input.amount - Math.max(balance.remaining, 0));
    return {
      kind: "over_balance",
      po,
      balance,
      shortfall,
      reason: `it needs ${inr(input.amount)} from PO ${po.po_number}, which has ${inr(Math.max(balance.remaining, 0))} left`,
    };
  };

  if (input.poId) {
    const chosen = mine.find((p) => p.id === input.poId);
    if (!chosen) return { kind: "ineligible", reason: "That purchase order wasn't found" };
    const why = ineligibility(chosen, input);
    return why ? { kind: "ineligible", reason: why } : decide(withBalance(chosen));
  }

  const eligible = mine.filter((p) => ineligibility(p, input) === null).map(withBalance);
  if (eligible.length === 0) {
    const reasons = mine.map((p) => ineligibility(p, input)).filter(Boolean);
    return { kind: "ineligible", reason: `No open purchase order covers this booking (${reasons.join("; ")})` };
  }
  const rank = (a: (typeof eligible)[number], b: (typeof eligible)[number]) =>
    Number(b.po.department_id !== null) - Number(a.po.department_id !== null) || a.po.valid_to.localeCompare(b.po.valid_to) || a.po.po_number.localeCompare(b.po.po_number);
  const fits = eligible.filter((e) => e.balance.remaining >= input.amount).sort(rank);
  if (fits.length) return decide(fits[0]);
  return decide([...eligible].sort((a, b) => b.balance.remaining - a.balance.remaining || rank(a, b))[0]);
}

/** Ledger rows for one PO, newest first, with a running balance (oldest → newest). */
export function ledger<A extends AllocationRecord & { created_at: string }>(po: Pick<PoRecord, "id" | "amount_inr">, allocations: readonly A[]): (A & { balanceAfter: number })[] {
  let balance = Number(po.amount_inr);
  return allocations
    .filter((a) => a.po_id === po.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((a) => {
      if (a.status !== "released") balance = round(balance - Number(a.amount_inr));
      return { ...a, balanceAfter: balance };
    })
    .reverse();
}

export interface NewPoInput {
  po_number: string;
  amount_inr: number;
  valid_from: string;
  valid_to: string;
  department_id?: string | null;
  description?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a new PO; returns the cleaned input or the first problem. */
export function validateNewPo(input: NewPoInput, existingNumbers: readonly string[]): { ok: true; value: NewPoInput } | { ok: false; error: string } {
  const po_number = input.po_number.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9/_.-]{0,39}$/.test(po_number)) return { ok: false, error: "PO number: letters, digits and - / _ . (up to 40)." };
  if (existingNumbers.some((n) => n.toUpperCase() === po_number)) return { ok: false, error: `PO ${po_number} already exists.` };
  if (!(Number.isFinite(input.amount_inr) && input.amount_inr > 0 && input.amount_inr < 1e12)) return { ok: false, error: "Enter the PO value." };
  if (!ISO.test(input.valid_from) || !ISO.test(input.valid_to)) return { ok: false, error: "Enter valid from and to dates." };
  if (input.valid_to < input.valid_from) return { ok: false, error: "The PO must end on or after it starts." };
  const description = input.description?.trim().slice(0, 200) || null;
  return { ok: true, value: { po_number, amount_inr: round(input.amount_inr), valid_from: input.valid_from, valid_to: input.valid_to, department_id: input.department_id || null, description } };
}
