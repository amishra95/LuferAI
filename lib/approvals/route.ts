import "server-only";

import { listApprovalChain, type NewApprovalRequest, type PortalUser } from "@/lib/data";
import { planSteps } from "@/lib/services/enterprise/approvalEngine";

/**
 * Who signs off a request that needs approval: the first `tiers` levels of
 * the company's chain, one after another (step 1 decides first; later steps
 * are queued until the one before approves), skipping the requester (nobody
 * approves their own request; the next tier steps up). Shared by venue
 * bookings and catalogue orders. An error when the company hasn't enough
 * approvers besides them.
 */
export async function assignApprovers(opts: {
  companyId: string;
  companyName: string;
  requesterId: string;
  users: PortalUser[];
  reasons: string[];
  tiers: number;
  /** The approval_policy_rules band that set the levels; its sla_hours sets each step's deadline. */
  ruleId?: string | null;
}): Promise<{ ok: true; approvals: NewApprovalRequest[]; approverNames: string[] } | { ok: false; message: string }> {
  if (opts.reasons.length === 0) return { ok: true, approvals: [], approverNames: [] };
  const reason = opts.reasons.join("; ");
  const planned = planSteps(await listApprovalChain(opts.companyId), { requesterId: opts.requesterId, levels: opts.tiers });
  if (!planned.ok) {
    const levels = opts.tiers === 1 ? "" : opts.tiers === 2 ? "two levels of " : `${opts.tiers} levels of `;
    return {
      ok: false,
      message: `This needs ${levels}sign-off (${reason}), but ${opts.companyName} doesn't have enough approvers set up besides you.`,
    };
  }
  return {
    ok: true,
    approvals: planned.steps.map((s) => ({ requested_by: opts.requesterId, approver_id: s.approver_id, reason, step: s.step, active: s.active, rule_id: opts.ruleId ?? null })),
    approverNames: planned.steps.map((s) => opts.users.find((u) => u.id === s.approver_id)?.name ?? "an approver"),
  };
}

/** "requires manager sign-off", "requires manager and senior sign-off", "requires 3 levels of sign-off". */
export function signOffPhrase(levels: number): string {
  if (levels <= 1) return "requires manager sign-off";
  if (levels === 2) return "requires manager and senior sign-off";
  return `requires ${levels} levels of sign-off, in order`;
}
