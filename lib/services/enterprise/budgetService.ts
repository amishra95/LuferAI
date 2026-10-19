/**
 * Team budgets and balance holds (migration 0030): a department's monthly or
 * quarterly limit, what's drawn against it, and whether a new request fits.
 * The budget_holds_check trigger enforces the same rules in Postgres (and locks
 * the budget row so concurrent requests can't both spend the last of it).
 *
 * Pure: tests import it directly (tests/enterprise-governance.test.mjs).
 */

export type BudgetPeriod = "monthly" | "quarterly";
/** approval: spend past the limit needs sign-off · block: it is refused. */
export type BudgetEnforcement = "approval" | "block";
export type HoldStatus = "held" | "committed" | "consumed" | "released";

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["monthly", "quarterly"];
export const ENFORCEMENTS: readonly BudgetEnforcement[] = ["approval", "block"];

export interface TeamBudget {
  id: string;
  tenant_id: string;
  department_id: string;
  period: BudgetPeriod | string;
  period_start: string;
  period_end: string;
  limit_inr: number;
  enforcement: BudgetEnforcement | string;
}

export interface BudgetHold {
  id: string;
  budget_id: string;
  /** Exactly one of booking_id / catalog_order_id is set. */
  booking_id: string | null;
  catalog_order_id?: string | null;
  amount_inr: number;
  status: HoldStatus | string;
  over_budget: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Day count of a month (1-based), in UTC so it never depends on the server's zone. */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The month, or the Indian FY quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar), a
 * YYYY-MM-DD date falls in. Mirrors team_budgets.period_end.
 */
export function periodFor(period: BudgetPeriod, date: string): { start: string; end: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const first = period === "monthly" ? m : m - ((m - 1) % 3);
  const last = period === "monthly" ? m : first + 2;
  return { start: isoDate(y, first, 1), end: isoDate(y, last, daysIn(y, last)) };
}

/** "Oct 2026" or "Q3 FY26-27 (Oct–Dec 2026)". */
export function periodLabel(period: BudgetPeriod | string, start: string): string {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  const month = (mm: number) => new Date(Date.UTC(2000, mm - 1, 1)).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
  if (period === "monthly") return `${month(m)} ${y}`;
  const fyStart = m >= 4 ? y : y - 1;
  const q = m >= 4 ? (m - 4) / 3 + 1 : 4;
  return `Q${q} FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)} (${month(m)}–${month(m + 2)} ${y})`;
}

/** How a hold follows its booking or order. Mirrors public.budget_hold_status_for. */
export function holdStatusFor(subjectStatus: string): HoldStatus {
  if (subjectStatus === "PENDING_APPROVAL") return "held";
  if (subjectStatus === "CANCELLED") return "released";
  if (subjectStatus === "COMPLETED" || subjectStatus === "SETTLED" || subjectStatus === "DELIVERED") return "consumed";
  return "committed";
}

export interface BudgetBalance {
  limit: number;
  /** Reserved by requests awaiting approval. */
  held: number;
  committed: number;
  consumed: number;
  remaining: number;
  /** Share of the limit drawn, 0–100+ (over 100 once overrun). */
  usedPct: number;
  overrun: boolean;
}

const subjectOf = (h: Pick<BudgetHold, "booking_id" | "catalog_order_id">) => h.booking_id ?? h.catalog_order_id ?? "";

/** Balance = limit − held − committed − consumed. Released holds give their amount back. */
export function budgetBalance(budget: Pick<TeamBudget, "id" | "limit_inr">, holds: readonly BudgetHold[], excludeSubjectId?: string): BudgetBalance {
  const sums = { held: 0, committed: 0, consumed: 0 };
  for (const h of holds) {
    if (h.budget_id !== budget.id || (excludeSubjectId !== undefined && subjectOf(h) === excludeSubjectId)) continue;
    if (h.status === "held" || h.status === "committed" || h.status === "consumed") sums[h.status] += Number(h.amount_inr);
  }
  const limit = Number(budget.limit_inr);
  const remaining = round(limit - sums.held - sums.committed - sums.consumed);
  return {
    limit,
    held: round(sums.held),
    committed: round(sums.committed),
    consumed: round(sums.consumed),
    remaining,
    usedPct: limit > 0 ? Math.round(((limit - remaining) / limit) * 1000) / 10 : 0,
    overrun: remaining < 0,
  };
}

export interface SpendRequest {
  tenantId: string;
  departmentId: string | null;
  /** YYYY-MM-DD: the event date, or the needed-by date for goods. */
  date: string;
  /** Pre-GST total the request commits. */
  amount: number;
  /** When re-checking an existing booking or order, its own holds don't count. */
  subjectId?: string;
}

/** Budgets of the request's department whose period contains its date (a monthly and a quarterly one can both apply). */
export function budgetsCovering(budgets: readonly TeamBudget[], req: Pick<SpendRequest, "tenantId" | "departmentId" | "date">): TeamBudget[] {
  if (!req.departmentId) return [];
  return budgets.filter((b) => b.tenant_id === req.tenantId && b.department_id === req.departmentId && req.date >= b.period_start && req.date <= b.period_end);
}

export interface PlannedHold {
  budget_id: string;
  over_budget: boolean;
}

export type SpendCheck =
  /** No budget covers it (no department, or none set for the period): nothing to hold. */
  | { kind: "none" }
  | { kind: "ok"; holds: PlannedHold[] }
  /** It goes past an 'approval' budget: allowed only through sign-off. */
  | { kind: "over"; holds: PlannedHold[]; reason: string; shortfall: number }
  /** It goes past a 'block' budget: no approval can allow it. */
  | { kind: "blocked"; reason: string };

/**
 * Whether a request fits every budget that covers it. Each covering budget gets
 * a hold; one it would overdraw is flagged over_budget (needs sign-off), unless
 * that budget is a hard cap, which refuses the request.
 */
export function checkSpend(budgets: readonly TeamBudget[], holds: readonly BudgetHold[], req: SpendRequest): SpendCheck {
  const covering = budgetsCovering(budgets, req);
  if (covering.length === 0) return { kind: "none" };

  const planned: PlannedHold[] = [];
  const reasons: string[] = [];
  let shortfall = 0;
  for (const b of [...covering].sort((x, y) => x.period_end.localeCompare(y.period_end))) {
    const { remaining } = budgetBalance(b, holds, req.subjectId);
    const label = `${b.period === "monthly" ? "monthly" : "quarterly"} budget for ${periodLabel(b.period, b.period_start)}`;
    if (req.amount <= remaining) {
      planned.push({ budget_id: b.id, over_budget: false });
      continue;
    }
    const left = Math.max(remaining, 0);
    if (b.enforcement === "block") {
      return { kind: "blocked", reason: `it needs ${inr(req.amount)} and the team's ${label} has ${inr(left)} left, which is a hard cap` };
    }
    planned.push({ budget_id: b.id, over_budget: true });
    reasons.push(`it needs ${inr(req.amount)} and the team's ${label} has ${inr(left)} left`);
    shortfall = Math.max(shortfall, round(req.amount - left));
  }
  return reasons.length ? { kind: "over", holds: planned, reason: reasons.join("; "), shortfall } : { kind: "ok", holds: planned };
}

export interface NewBudgetInput {
  department_id: string;
  period: BudgetPeriod;
  period_start: string;
  limit_inr: number;
  enforcement: BudgetEnforcement;
}

/**
 * Validates the budget form. `month` is YYYY-MM; a quarterly budget starts at
 * the beginning of that month's FY quarter.
 */
export function parseBudgetInput(raw: { departmentId?: unknown; period?: unknown; month?: unknown; limit?: unknown; enforcement?: unknown }):
  | { ok: true; value: NewBudgetInput }
  | { ok: false; error: string } {
  const departmentId = typeof raw.departmentId === "string" ? raw.departmentId.trim() : "";
  if (!departmentId) return { ok: false, error: "Choose a team." };
  if (!BUDGET_PERIODS.includes(raw.period as BudgetPeriod)) return { ok: false, error: "Choose monthly or quarterly." };
  const period = raw.period as BudgetPeriod;
  const month = typeof raw.month === "string" ? raw.month.trim() : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: "Choose the month the budget starts in." };
  const limit = typeof raw.limit === "number" ? raw.limit : Number(String(raw.limit ?? "").replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(limit) || limit <= 0) return { ok: false, error: "Enter a limit above ₹0." };
  if (limit >= 1e12) return { ok: false, error: "That limit is too large." };
  const enforcement = (raw.enforcement ?? "approval") as BudgetEnforcement;
  if (!ENFORCEMENTS.includes(enforcement)) return { ok: false, error: "Choose what happens past the limit." };
  return {
    ok: true,
    value: { department_id: departmentId, period, period_start: periodFor(period, `${month}-01`).start, limit_inr: round(limit), enforcement },
  };
}
