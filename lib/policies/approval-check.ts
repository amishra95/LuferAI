/**
 * "Will this need approval?" on Policies → Rules: runs a made-up booking
 * through the same checks a real one goes through (evaluateBookingPolicy, the
 * spending band, approvalDemand) and says who has to sign off. Pure, so it runs
 * in the browser as the rules are edited, before they're saved.
 *
 * Not included: team budgets (need live balances) and a team's own per-head
 * limits (department_policies); a real booking can still need approval for those.
 */
import { approvalDemand, matchRule, type ApprovalRule } from "../services/enterprise/approvalEngine.ts";
import { evaluateBookingPolicy, type EventType } from "./evaluate-booking-policy.ts";
import { rowsFromRules, type Entertainment, type PolicyRules } from "./policy-rules.ts";

export interface TrialBooking {
  guests: number;
  perHead: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  startTime: string;
  eventType: EventType;
  alcohol: boolean;
  entertainment: Entertainment[];
  /** km from the office; null = unknown. */
  distanceKm: number | null;
  departmentId: string | null;
}

export type TrialVerdict =
  | { kind: "instant"; total: number }
  | { kind: "approval"; total: number; levels: number; reasons: string[]; approvers: { level: number; name: string | null }[]; chainShort: boolean }
  | { kind: "blocked"; total: number; reason: string };

export function checkTrialBooking(
  companyId: string,
  rules: PolicyRules,
  bands: readonly ApprovalRule[],
  chain: readonly { tier: number; name: string }[],
  trial: TrialBooking,
  /** Committed pre-GST spend per "YYYY-MM", for the monthly limit. */
  committedByMonth: Readonly<Record<string, number>> = {}
): TrialVerdict {
  const total = Math.round(trial.guests * trial.perHead * 100) / 100;
  const { policy, monthlyLimit } = rowsFromRules(rules);
  const spend = monthlyLimit > 0 && trial.date ? { monthly_limit: monthlyLimit, month_to_date: committedByMonth[trial.date.slice(0, 7)] ?? 0 } : null;
  const verdict = evaluateBookingPolicy(
    policy,
    {
      total_amount: total,
      headcount: trial.guests,
      per_head_amount: trial.perHead,
      alcohol_included: trial.alcohol,
      entertainment: trial.entertainment,
      event_date: trial.date || undefined,
      event_type: trial.eventType,
      event_start_time: trial.startTime || null,
      distance_from_office_km: trial.distanceKm,
    },
    spend
  );
  if (verdict.blocked) return { kind: "blocked", total, reason: verdict.reason };

  const rule = matchRule(bands, { tenantId: companyId, departmentId: trial.departmentId, amount: total });
  const demand = approvalDemand({
    policy: verdict.requiresApproval ? { requiresApproval: true, reason: verdict.reason, tiers: verdict.tiers } : { requiresApproval: false },
    amount: total,
    rule,
  });
  if (!demand.required) return { kind: "instant", total };
  const approvers = Array.from({ length: demand.levels }, (_, i) => ({ level: i + 1, name: chain.find((t) => t.tier === i + 1)?.name ?? null }));
  return { kind: "approval", total, levels: demand.levels, reasons: demand.reasons, approvers, chainShort: approvers.some((a) => a.name === null) };
}

/** Committed spend per month from bookings/orders (cancelled ones don't count), for the monthly limit. */
export function committedByMonth(rows: readonly { event_date: string | null; status: string; total_amount_inr: number | string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.event_date || r.status === "CANCELLED") continue;
    const m = r.event_date.slice(0, 7);
    out[m] = (out[m] ?? 0) + Number(r.total_amount_inr);
  }
  return out;
}
