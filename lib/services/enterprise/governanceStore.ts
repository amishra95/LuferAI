import "server-only";

import { dataSource, listApprovalChain, listApprovals, listDepartments, listPortalUsers, type ApprovalDetail, type PortalUser } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApprovalPolicyRule, BudgetHoldRow, TeamBudgetRow } from "@/lib/supabase/database.types";
import { chainProgress, matchRule, overlappingRule, requestOutcome, type ApprovalRule, type RuleInput, type StepProgress } from "./approvalEngine";
import { budgetBalance, checkSpend, type BudgetBalance, type BudgetHold, type NewBudgetInput, type SpendCheck, type SpendRequest, type TeamBudget } from "./budgetService";

/**
 * Governance data (migration 0030): approval rules, the approval hierarchy,
 * team budgets and their holds, and approval requests with their step progress.
 *
 * Supabase only: in Redis / mock mode (and before the migration) reads come back
 * empty with ready: false, booking checks find no rules or budgets, and writes
 * explain why they can't be saved. Writes go through the service role; callers
 * authorise and pass the acting member's own company (lib/services/enterprise/access.ts).
 */

const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export const GOVERNANCE_UNAVAILABLE = "Approval rules and team budgets need Supabase with database migration 0030 (enterprise governance). Ask an admin to apply it.";

/** A refusal to show the user; `status` is the HTTP status the API returns for it. */
export class GovernanceError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}

const supabaseOnly = () => {
  if (dataSource() !== "supabase") throw new GovernanceError(GOVERNANCE_UNAVAILABLE, 503);
  return createAdminClient();
};

/** Postgres check failures (23514/23P01/23505) carry a message written for people; everything else is a 500. */
function refusal(error: { code?: string; message: string } | null): never {
  if (isMissingTable(error)) throw new GovernanceError(GOVERNANCE_UNAVAILABLE, 503);
  if (error?.code === "23514" || error?.code === "23P01" || error?.code === "23505" || error?.code === "23503") {
    throw new GovernanceError(error.code === "23P01" ? "Another active rule already covers part of that amount range for the same teams." : error.message, 409);
  }
  throw error;
}

const toRule = (r: ApprovalPolicyRule): ApprovalRule => ({
  ...r,
  min_amount_inr: Number(r.min_amount_inr),
  max_amount_inr: r.max_amount_inr === null ? null : Number(r.max_amount_inr),
});

const toBudget = (b: TeamBudgetRow): TeamBudget => ({ ...b, period_end: b.period_end ?? b.period_start, limit_inr: Number(b.limit_inr) });
const toHold = (h: BudgetHoldRow): BudgetHold => ({ ...h, amount_inr: Number(h.amount_inr) });

// ----------------------------------------------------------------------------
// Rules
// ----------------------------------------------------------------------------

export async function listRules(tenantId: string): Promise<{ rules: ApprovalRule[]; ready: boolean }> {
  if (dataSource() !== "supabase") return { rules: [], ready: false };
  const { data, error } = await createAdminClient().from("approval_policy_rules").select("*").eq("tenant_id", tenantId).order("min_amount_inr");
  if (isMissingTable(error)) return { rules: [], ready: false };
  if (error) throw error;
  return { rules: data.map(toRule), ready: true };
}

/** Creates a rule, or replaces one of the company's own (`id`). Overlapping active bands are refused. */
export async function saveRule(tenantId: string, input: RuleInput, userId: string | null, id?: string): Promise<ApprovalRule> {
  const db = supabaseOnly();
  if (input.department_id && !(await listDepartments({ companyIds: [tenantId] })).some((d) => d.id === input.department_id)) {
    throw new GovernanceError("Unknown team.");
  }
  const { rules } = await listRules(tenantId);
  if (id && !rules.some((r) => r.id === id)) throw new GovernanceError("That rule wasn't found.", 404);
  const clash = overlappingRule(rules, { ...input, tenant_id: tenantId, id });
  if (clash) throw new GovernanceError(`It overlaps “${clash.name}”. Change one of the amount ranges first.`, 409);

  const query = id
    ? db.from("approval_policy_rules").update(input).eq("id", id).eq("tenant_id", tenantId)
    : db.from("approval_policy_rules").insert({ ...input, tenant_id: tenantId, created_by: userId });
  const { data, error } = await query.select("*").single();
  if (error) refusal(error);
  return toRule(data);
}

/** Pauses or resumes a rule. Resuming is refused if another active rule now covers its range. */
export async function setRuleActive(tenantId: string, id: string, active: boolean): Promise<ApprovalRule> {
  const { data, error } = await supabaseOnly().from("approval_policy_rules").update({ is_active: active }).eq("id", id).eq("tenant_id", tenantId).select("*").maybeSingle();
  if (error) refusal(error);
  if (!data) throw new GovernanceError("That rule wasn't found.", 404);
  return toRule(data);
}

/** Approvals it already raised keep their steps (rule_id is cleared). */
export async function deleteRule(tenantId: string, id: string): Promise<void> {
  const { data, error } = await supabaseOnly().from("approval_policy_rules").delete().eq("id", id).eq("tenant_id", tenantId).select("id");
  if (error) refusal(error);
  if (data.length === 0) throw new GovernanceError("That rule wasn't found.", 404);
}

// ----------------------------------------------------------------------------
// The approval hierarchy (approval_chains)
// ----------------------------------------------------------------------------

export interface HierarchyTier {
  tier: number;
  userId: string;
  name: string;
}

export async function getHierarchy(tenantId: string, users?: PortalUser[]): Promise<HierarchyTier[]> {
  const [chain, people] = await Promise.all([listApprovalChain(tenantId), users ?? listPortalUsers({ companyId: tenantId })]);
  return chain.map((c) => ({ tier: c.tier_level, userId: c.approver_user_id, name: people.find((u) => u.id === c.approver_user_id)?.name ?? "Unknown user" }));
}

/** Replaces the hierarchy: approverIds[0] becomes tier 1. Everyone must be one of the company's Approvers. */
export async function saveHierarchy(tenantId: string, approverIds: string[]): Promise<HierarchyTier[]> {
  const db = supabaseOnly();
  if (approverIds.length > 10) throw new GovernanceError("An approval chain has at most 10 tiers.");
  if (new Set(approverIds).size !== approverIds.length) throw new GovernanceError("Each person can hold only one tier.");
  const users = await listPortalUsers({ companyId: tenantId });
  const notApprover = approverIds.find((id) => users.find((u) => u.id === id)?.role !== "APPROVER");
  if (notApprover) {
    const who = users.find((u) => u.id === notApprover);
    throw new GovernanceError(who ? `${who.name} isn't an Approver. Change their role first.` : "Choose people from your company.");
  }
  const { error } = await db.rpc("replace_approval_chain", { p_tenant_id: tenantId, p_approvers: approverIds });
  if (error) refusal(error);
  return getHierarchy(tenantId, users);
}

// ----------------------------------------------------------------------------
// Budgets
// ----------------------------------------------------------------------------

export interface BudgetView extends TeamBudget {
  departmentName: string;
  balance: BudgetBalance;
  holds: BudgetHold[];
}

async function loadBudgets(tenantId: string): Promise<{ budgets: TeamBudget[]; holds: BudgetHold[]; ready: boolean }> {
  if (dataSource() !== "supabase") return { budgets: [], holds: [], ready: false };
  const db = createAdminClient();
  const [b, h] = await Promise.all([
    db.from("team_budgets").select("*").eq("tenant_id", tenantId).order("period_start", { ascending: false }),
    db.from("budget_holds").select("*").eq("tenant_id", tenantId),
  ]);
  if (isMissingTable(b.error) || isMissingTable(h.error)) return { budgets: [], holds: [], ready: false };
  if (b.error) throw b.error;
  if (h.error) throw h.error;
  return { budgets: b.data.map(toBudget), holds: h.data.map(toHold), ready: true };
}

export async function listBudgets(tenantId: string): Promise<{ budgets: BudgetView[]; ready: boolean }> {
  const [{ budgets, holds, ready }, departments] = await Promise.all([loadBudgets(tenantId), listDepartments({ companyIds: [tenantId] })]);
  return {
    ready,
    budgets: budgets.map((b) => ({
      ...b,
      departmentName: departments.find((d) => d.id === b.department_id)?.name ?? "Unknown team",
      balance: budgetBalance(b, holds),
      holds: holds.filter((h) => h.budget_id === b.id),
    })),
  };
}

/** Sets a team's limit for a period (creating or replacing it). Lowering it below what's drawn is allowed and shows as an overrun. */
export async function saveBudget(tenantId: string, input: NewBudgetInput, userId: string | null): Promise<TeamBudget> {
  const db = supabaseOnly();
  if (!(await listDepartments({ companyIds: [tenantId] })).some((d) => d.id === input.department_id)) throw new GovernanceError("Unknown team.");
  const { data, error } = await db
    .from("team_budgets")
    .upsert({ ...input, tenant_id: tenantId, created_by: userId }, { onConflict: "department_id,period,period_start" })
    .select("*")
    .single();
  if (error) refusal(error);
  return toBudget(data);
}

/** Only a budget nothing has drawn from can be deleted; otherwise change its limit. */
export async function deleteBudget(tenantId: string, id: string): Promise<void> {
  const { data, error } = await supabaseOnly().from("team_budgets").delete().eq("id", id).eq("tenant_id", tenantId).select("id");
  if (error?.code === "23503") throw new GovernanceError("Bookings already draw from this budget. Change its limit instead.", 409);
  if (error) refusal(error);
  if (data.length === 0) throw new GovernanceError("That budget wasn't found.", 404);
}

// ----------------------------------------------------------------------------
// Booking-time checks (lib/bookings/place-booking.ts)
// ----------------------------------------------------------------------------

export interface GovernanceCheck {
  rule: ApprovalRule | null;
  spend: SpendCheck;
}

const NO_GOVERNANCE: GovernanceCheck = { rule: null, spend: { kind: "none" } };

/**
 * The approval rule a request falls under and whether it fits its team's budgets.
 * Without Supabase or the migration, there are neither.
 */
export async function checkGovernance(req: SpendRequest): Promise<GovernanceCheck> {
  if (dataSource() !== "supabase") return NO_GOVERNANCE;
  const [{ rules, ready }, budgets] = await Promise.all([listRules(req.tenantId), loadBudgets(req.tenantId)]);
  if (!ready) return NO_GOVERNANCE;
  return {
    rule: matchRule(rules, { tenantId: req.tenantId, departmentId: req.departmentId, amount: req.amount }),
    spend: budgets.ready ? checkSpend(budgets.budgets, budgets.holds, req) : { kind: "none" },
  };
}

// ----------------------------------------------------------------------------
// Approval requests and escalation
// ----------------------------------------------------------------------------

export interface ApprovalRequestView {
  subjectId: string;
  subject: ApprovalDetail["subject"];
  booking: ApprovalDetail["booking"];
  requesterName: string;
  reason: string | null;
  createdAt: string;
  outcome: "pending" | "approved" | "rejected";
  steps: (StepProgress & { approverName: string; escalatedFromNames: string[] })[];
}

/** The company's approval requests, newest first, each with its steps in order. */
export async function listApprovalRequests(tenantId: string, filter: { outcome?: ApprovalRequestView["outcome"] } = {}): Promise<ApprovalRequestView[]> {
  const rows = await listApprovals({ tenantId });
  const bySubject = new Map<string, ApprovalDetail[]>();
  for (const a of rows) {
    const key = a.booking_id ?? a.catalog_order_id ?? a.id;
    bySubject.set(key, [...(bySubject.get(key) ?? []), a]);
  }
  const names = new Map(rows.flatMap((a) => [[a.approver_id, a.approver_name] as const, [a.requested_by, a.requester_name] as const]));
  const views = [...bySubject.entries()].map(([subjectId, approvals]): ApprovalRequestView => {
    const first = approvals.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
    return {
      subjectId,
      subject: first.subject,
      booking: first.booking,
      requesterName: first.requester_name,
      reason: first.reason,
      createdAt: first.created_at,
      outcome: requestOutcome(approvals),
      steps: chainProgress(approvals).map((s) => ({
        ...s,
        approverName: names.get(s.approval.approver_id) ?? "Unknown user",
        escalatedFromNames: s.escalatedFrom.map((e) => names.get(e.approver_id) ?? "Unknown user"),
      })),
    };
  });
  return views.filter((v) => !filter.outcome || v.outcome === filter.outcome).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Hands a waiting approval of the company's to the next tier up. Returns the new approval's id. */
export async function escalateApproval(tenantId: string, approvalId: string, reason: string | null): Promise<string> {
  const db = supabaseOnly();
  const { data: own, error: lookup } = await db.from("booking_approvals").select("id").eq("id", approvalId).eq("tenant_id", tenantId).maybeSingle();
  if (lookup) throw lookup;
  if (!own) throw new GovernanceError("That approval wasn't found.", 404);
  const { data, error } = await db.rpc("escalate_booking_approval", { p_approval_id: approvalId, p_reason: reason ?? undefined });
  if (error) refusal(error);
  return data;
}

/** Cron: escalates every overdue approval that has somewhere to go. */
export async function escalateOverdueApprovals(): Promise<number> {
  const { data, error } = await createAdminClient().rpc("escalate_overdue_approvals");
  if (isMissingTable(error) || error?.code === "PGRST202" || error?.code === "42883") return 0; // before migration 0030
  if (error) throw error;
  return data;
}
