import "server-only";

import { listApprovalChain, type NewApprovalRequest, type PortalUser } from "@/lib/data";

/**
 * Who signs off a request that needs approval: the first `tiers` levels of
 * the company's chain, skipping the requester (nobody approves their own
 * request; the next tier steps up). Shared by venue bookings and catalogue
 * orders. An error when the company hasn't enough approvers besides them.
 */
export async function assignApprovers(opts: {
  companyId: string;
  companyName: string;
  requesterId: string;
  users: PortalUser[];
  reasons: string[];
  tiers: 1 | 2;
}): Promise<{ ok: true; approvals: NewApprovalRequest[]; approverNames: string[] } | { ok: false; message: string }> {
  if (opts.reasons.length === 0) return { ok: true, approvals: [], approverNames: [] };
  const reason = opts.reasons.join("; ");
  const chain = (await listApprovalChain(opts.companyId)).filter((c) => c.approver_user_id !== opts.requesterId);
  const assigned = chain.slice(0, opts.tiers);
  if (assigned.length < opts.tiers) {
    return {
      ok: false,
      message: `This needs ${opts.tiers === 2 ? "two levels of " : ""}sign-off (${reason}), but ${opts.companyName} doesn't have enough approvers set up besides you.`,
    };
  }
  return {
    ok: true,
    approvals: assigned.map((c) => ({ requested_by: opts.requesterId, approver_id: c.approver_user_id, reason })),
    approverNames: assigned.map((c) => opts.users.find((u) => u.id === c.approver_user_id)?.name ?? "an approver"),
  };
}
