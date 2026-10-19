import type { NextRequest } from "next/server";

import { authorize, data, failed, json } from "@/lib/api/respond";
import { canViewGovernance, governedCompany } from "@/lib/services/enterprise/access";
import { ApprovalCommand, runApprovalCommand } from "@/lib/services/enterprise/commands";
import { getHierarchy, GovernanceError, listApprovalRequests, listRules } from "@/lib/services/enterprise/governanceStore";

/**
 * GET /api/enterprise/approvals: the company's approval requests, each with its
 * sequential steps (who, queued / waiting / approved / rejected, deadlines and
 * escalations), plus the approval rules and hierarchy that route them.
 * ?outcome=pending|approved|rejected filters the requests.
 *
 * POST /api/enterprise/approvals { action, … }:
 *   decide          { approvalId, decision: APPROVED | REJECTED, note? }  the assigned approver (admins on their behalf)
 *   escalate        { approvalId, reason? }        hand a waiting step to the next tier up
 *   saveRule        { id?, name, departmentId?, minAmount?, maxAmount?, levels, slaHours? }
 *   setRuleActive   { id, active }
 *   deleteRule      { id }
 *   saveHierarchy   { approverIds }                approverIds[0] becomes tier 1
 * Everything but decide needs an Approver or an admin (lib/services/enterprise/access.ts).
 *
 * Clients act on their own company; admins pass ?company=<id>.
 */
const OUTCOMES = new Set(["pending", "approved", "rejected"]);

export async function GET(request: NextRequest) {
  const auth = await authorize(canViewGovernance);
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const companyId = governedCompany(auth.member, params.get("company"));
  if (!companyId) return json({ error: "Pass ?company=<id>." }, 400);
  const outcome = params.get("outcome");
  if (outcome && !OUTCOMES.has(outcome)) return json({ error: "outcome must be pending, approved or rejected." }, 400);

  try {
    const [requests, { rules, ready }, hierarchy] = await Promise.all([
      listApprovalRequests(companyId, { outcome: (outcome ?? undefined) as "pending" | "approved" | "rejected" | undefined }),
      listRules(companyId),
      getHierarchy(companyId),
    ]);
    return data({ ready, requests, rules, hierarchy });
  } catch (err) {
    return failed("api/enterprise/approvals", err);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(canViewGovernance);
  if ("response" in auth) return auth.response;
  const companyId = governedCompany(auth.member, request.nextUrl.searchParams.get("company"));
  if (!companyId) return json({ error: "Pass ?company=<id>." }, 400);

  const parsed = ApprovalCommand.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request", issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) }, 400);

  try {
    return json(await runApprovalCommand(auth.member, companyId, parsed.data));
  } catch (err) {
    if (err instanceof GovernanceError) return json({ error: err.message }, err.status);
    return failed("api/enterprise/approvals", err);
  }
}
