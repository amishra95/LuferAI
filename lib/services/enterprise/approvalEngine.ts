/**
 * Enterprise approval engine (migration 0030): which approval_policy_rules band
 * a request falls in, how many levels of the company's approval_chains must
 * sign off, and the sequential steps that come out of it.
 *
 * Postgres owns the state machine: booking_approvals triggers activate step n+1
 * once step n is approved, refuse decisions on queued steps, and
 * escalate_booking_approval hands an overdue step to the next tier. The helpers
 * here mirror those rules for the local stores, the UI and the API.
 *
 * Pure: tests import it directly (tests/enterprise-governance.test.mjs).
 */

export const MAX_LEVELS = 10;
export const DEFAULT_SLA_HOURS = 48;

export interface ApprovalRule {
  id: string;
  tenant_id: string;
  /** null = every department; a department's own rule wins. */
  department_id: string | null;
  name: string;
  /** Exclusive lower bound, pre-GST. */
  min_amount_inr: number;
  /** Inclusive upper bound; null = none. */
  max_amount_inr: number | null;
  approval_levels: number;
  sla_hours: number;
  is_active: boolean;
}

export interface ChainTier {
  approver_user_id: string;
  tier_level: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Whether a pre-GST total falls in the rule's (min, max] band. */
export function ruleCovers(rule: Pick<ApprovalRule, "min_amount_inr" | "max_amount_inr">, amount: number): boolean {
  return amount > Number(rule.min_amount_inr) && (rule.max_amount_inr === null || amount <= Number(rule.max_amount_inr));
}

export function bandLabel(rule: Pick<ApprovalRule, "min_amount_inr" | "max_amount_inr">): string {
  const min = Number(rule.min_amount_inr);
  if (rule.max_amount_inr === null) return `above ${inr(min)}`;
  return min === 0 ? `up to ${inr(Number(rule.max_amount_inr))}` : `${inr(min)} – ${inr(Number(rule.max_amount_inr))}`;
}

/**
 * The active rule a request falls under: the department's own band first, then
 * the company-wide one. null = no band covers it, so rules don't require sign-off
 * (a threshold bypass; corporate policy and budgets can still require it).
 */
export function matchRule(rules: readonly ApprovalRule[], req: { tenantId: string; departmentId: string | null; amount: number }): ApprovalRule | null {
  const live = rules.filter((r) => r.is_active && r.tenant_id === req.tenantId && ruleCovers(r, req.amount));
  return (req.departmentId ? live.find((r) => r.department_id === req.departmentId) : undefined) ?? live.find((r) => r.department_id === null) ?? null;
}

export interface ApprovalInputs {
  /** evaluateBookingPolicy's verdict (lib/policies). */
  policy: { requiresApproval: boolean; reason?: string; tiers?: number };
  /** The pre-GST total, for the rule's wording. */
  amount: number;
  rule: ApprovalRule | null;
  /** Why the team budget needs sign-off (budgetService checkSpend "over"), if it does. */
  budgetReason?: string | null;
  /** Other reasons (e.g. an overdrawn PO). */
  extraReasons?: readonly string[];
}

export type ApprovalDemand =
  | { required: false }
  | { required: true; levels: number; reasons: string[]; ruleId: string | null; slaHours: number | null };

/**
 * Everything that asks for sign-off, combined: the strictest decides how many
 * levels. A matching rule sets the levels for its band and the deadline per step;
 * policy, budget and PO breaches need at least one level (policy can ask for two).
 */
export function approvalDemand(input: ApprovalInputs): ApprovalDemand {
  const reasons: string[] = [];
  let levels = 0;
  if (input.policy.requiresApproval) {
    if (input.policy.reason) reasons.push(input.policy.reason);
    levels = Math.max(levels, input.policy.tiers ?? 1);
  }
  if (input.rule) {
    const n = input.rule.approval_levels;
    reasons.push(`${inr(input.amount)} falls in the “${input.rule.name}” band (${bandLabel(input.rule)}), which needs ${n === 1 ? "one level" : `${n} levels`} of sign-off`);
    levels = Math.max(levels, n);
  }
  for (const r of [input.budgetReason, ...(input.extraReasons ?? [])]) {
    if (r) {
      reasons.push(r);
      levels = Math.max(levels, 1);
    }
  }
  if (levels === 0) return { required: false };
  return { required: true, levels: Math.min(levels, MAX_LEVELS), reasons, ruleId: input.rule?.id ?? null, slaHours: input.rule?.sla_hours ?? null };
}

export interface PlannedStep {
  approver_id: string;
  tier_level: number;
  step: number;
  /** Only the first step is the approver's to decide straight away; the rest wait their turn. */
  active: boolean;
}

/**
 * The first `levels` tiers of the chain, lowest first, as sequential steps.
 * Nobody approves their own request: the requester is skipped and the next tier
 * steps up. Fails when the chain is too short.
 */
export function planSteps(chain: readonly ChainTier[], opts: { requesterId: string; levels: number }):
  | { ok: true; steps: PlannedStep[] }
  | { ok: false; available: number } {
  const eligible = [...chain].sort((a, b) => a.tier_level - b.tier_level).filter((c) => c.approver_user_id !== opts.requesterId);
  if (eligible.length < opts.levels) return { ok: false, available: eligible.length };
  return {
    ok: true,
    steps: eligible.slice(0, opts.levels).map((c, i) => ({ approver_id: c.approver_user_id, tier_level: c.tier_level, step: i + 1, active: i === 0 })),
  };
}

// ----------------------------------------------------------------------------
// The sequence as it runs (mirrors the booking_approvals triggers)
// ----------------------------------------------------------------------------

export type ApprovalState = "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED";

export interface ApprovalRow {
  id: string;
  approver_id: string;
  requested_by: string;
  status: ApprovalState | string;
  step: number;
  activated_at: string | null;
  due_at: string | null;
  escalated_from?: string | null;
}

/** Whether the approver can decide it now: pending and its step is active. */
export const isActionable = (a: Pick<ApprovalRow, "status" | "activated_at">) => a.status === "PENDING" && a.activated_at !== null;

export const isOverdue = (a: Pick<ApprovalRow, "status" | "activated_at" | "due_at">, now: Date) =>
  isActionable(a) && a.due_at !== null && new Date(a.due_at).getTime() < now.getTime();

/**
 * After `approvedId` is approved, the approvals whose step becomes active:
 * the lowest queued step, once nothing active is left open. Empty otherwise.
 */
export function stepsToActivate(approvals: readonly ApprovalRow[], approvedId: string): string[] {
  const rest = approvals.filter((a) => a.id !== approvedId);
  if (rest.some(isActionable)) return [];
  const queued = rest.filter((a) => a.status === "PENDING" && a.activated_at === null);
  if (queued.length === 0) return [];
  const next = Math.min(...queued.map((a) => a.step));
  return queued.filter((a) => a.step === next).map((a) => a.id);
}

/** The request's outcome: any rejection ends it; every live step approved releases it. ESCALATED rows were handed on. */
export function requestOutcome(approvals: readonly Pick<ApprovalRow, "status">[]): "pending" | "approved" | "rejected" {
  const live = approvals.filter((a) => a.status !== "ESCALATED");
  if (live.some((a) => a.status === "REJECTED")) return "rejected";
  return live.length > 0 && live.every((a) => a.status === "APPROVED") ? "approved" : "pending";
}

export interface StepProgress {
  step: number;
  /** The live approval for the step (the latest after any escalation). */
  approval: ApprovalRow;
  /** Earlier approvers who escalated it, oldest first. */
  escalatedFrom: ApprovalRow[];
  state: "queued" | "waiting" | "approved" | "rejected";
}

/** One line per step for the UI, in order. */
export function chainProgress(approvals: readonly ApprovalRow[]): StepProgress[] {
  const steps = [...new Set(approvals.map((a) => a.step))].sort((a, b) => a - b);
  return steps.map((step) => {
    const rows = approvals.filter((a) => a.step === step);
    const approval = rows.find((a) => a.status !== "ESCALATED") ?? rows[rows.length - 1];
    const escalatedFrom = rows.filter((a) => a.status === "ESCALATED");
    const state =
      approval.status === "APPROVED" ? "approved" : approval.status === "REJECTED" ? "rejected" : approval.activated_at === null ? "queued" : "waiting";
    return { step, approval, escalatedFrom, state };
  });
}

/**
 * Who an approval escalates to: the next tier above its approver that isn't the
 * requester and isn't already on the request. Mirrors escalate_booking_approval.
 */
export function escalationTarget(chain: readonly ChainTier[], approvals: readonly ApprovalRow[], approvalId: string): string | null {
  const a = approvals.find((x) => x.id === approvalId);
  if (!a) return null;
  const current = chain.find((c) => c.approver_user_id === a.approver_id)?.tier_level ?? 0;
  const onRequest = new Set(approvals.filter((x) => x.status === "PENDING" || x.status === "APPROVED").map((x) => x.approver_id));
  const next = [...chain]
    .sort((x, y) => x.tier_level - y.tier_level)
    .find((c) => c.tier_level > current && c.approver_user_id !== a.requested_by && !onRequest.has(c.approver_user_id));
  return next?.approver_user_id ?? null;
}

// ----------------------------------------------------------------------------
// Rule form
// ----------------------------------------------------------------------------

export interface RuleInput {
  name: string;
  department_id: string | null;
  min_amount_inr: number;
  max_amount_inr: number | null;
  approval_levels: number;
  sla_hours: number;
}

const money = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[₹,\s]/g, "");
  return s === "" ? null : Number(s);
};

/** Validates the rule form (amounts may carry ₹ and commas; a blank maximum means no upper bound). */
export function parseRuleInput(raw: { name?: unknown; departmentId?: unknown; minAmount?: unknown; maxAmount?: unknown; levels?: unknown; slaHours?: unknown }):
  | { ok: true; value: RuleInput }
  | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 80) return { ok: false, error: "Give the rule a name (up to 80 characters)." };
  const min = money(raw.minAmount) ?? 0;
  const max = money(raw.maxAmount);
  if (!Number.isFinite(min) || min < 0) return { ok: false, error: "The lower bound must be ₹0 or more." };
  if (max !== null && (!Number.isFinite(max) || max <= min)) return { ok: false, error: `The upper bound must be above ${inr(min)}, or blank for no limit.` };
  const levels = Number(raw.levels);
  if (!Number.isInteger(levels) || levels < 1 || levels > MAX_LEVELS) return { ok: false, error: `Approval levels must be 1 to ${MAX_LEVELS}.` };
  const sla = raw.slaHours === undefined || raw.slaHours === "" ? DEFAULT_SLA_HOURS : Number(raw.slaHours);
  if (!Number.isInteger(sla) || sla < 1 || sla > 720) return { ok: false, error: "The deadline must be 1 to 720 hours." };
  const department = typeof raw.departmentId === "string" && raw.departmentId.trim() ? raw.departmentId.trim() : null;
  return { ok: true, value: { name, department_id: department, min_amount_inr: min, max_amount_inr: max, approval_levels: levels, sla_hours: sla } };
}

/** An active rule in the same scope whose band overlaps, or null. Mirrors approval_policy_rules_no_overlap. */
export function overlappingRule(rules: readonly ApprovalRule[], candidate: RuleInput & { tenant_id: string; id?: string }): ApprovalRule | null {
  const hi = (v: number | null) => (v === null ? Infinity : Number(v));
  return (
    rules.find(
      (r) =>
        r.is_active &&
        r.id !== candidate.id &&
        r.tenant_id === candidate.tenant_id &&
        r.department_id === candidate.department_id &&
        Number(r.min_amount_inr) < hi(candidate.max_amount_inr) &&
        candidate.min_amount_inr < hi(r.max_amount_inr)
    ) ?? null
  );
}

/** Tiers a chain must have for every active rule to be satisfiable: the highest level any rule asks for. */
export function levelsNeeded(rules: readonly ApprovalRule[]): number {
  return rules.filter((r) => r.is_active).reduce((n, r) => Math.max(n, r.approval_levels), 0);
}
