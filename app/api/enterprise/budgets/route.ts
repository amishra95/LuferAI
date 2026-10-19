import type { NextRequest } from "next/server";

import { authorize, data, failed, json } from "@/lib/api/respond";
import { listDepartments } from "@/lib/data";
import { canViewGovernance, governedCompany } from "@/lib/services/enterprise/access";
import { BudgetCommand, runBudgetCommand } from "@/lib/services/enterprise/commands";
import { GovernanceError, listBudgets } from "@/lib/services/enterprise/governanceStore";

/**
 * GET /api/enterprise/budgets: the company's monthly and quarterly team budgets,
 * each with its balance (held for pending approvals, committed, consumed,
 * remaining) and the holds drawing from it, plus the teams (departments).
 *
 * POST /api/enterprise/budgets { action, … }:
 *   save    { departmentId, period: monthly | quarterly, month: YYYY-MM, limit, enforcement?: approval | block }
 *           sets the team's limit for the month, or for the FY quarter containing it (Approvers and admins)
 *   delete  { id }   only a budget nothing has drawn from (Approvers and admins)
 *   check   { departmentId, date: YYYY-MM-DD, amount }   dry run: would this spend fit? Writes nothing.
 *
 * Clients act on their own company; admins pass ?company=<id>.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(canViewGovernance);
  if ("response" in auth) return auth.response;
  const companyId = governedCompany(auth.member, request.nextUrl.searchParams.get("company"));
  if (!companyId) return json({ error: "Pass ?company=<id>." }, 400);

  try {
    const [{ budgets, ready }, departments] = await Promise.all([listBudgets(companyId), listDepartments({ companyIds: [companyId] })]);
    return data({ ready, budgets, departments: departments.map((d) => ({ id: d.id, name: d.name })) });
  } catch (err) {
    return failed("api/enterprise/budgets", err);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(canViewGovernance);
  if ("response" in auth) return auth.response;
  const companyId = governedCompany(auth.member, request.nextUrl.searchParams.get("company"));
  if (!companyId) return json({ error: "Pass ?company=<id>." }, 400);

  const parsed = BudgetCommand.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request", issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) }, 400);

  try {
    return json(await runBudgetCommand(auth.member, companyId, parsed.data));
  } catch (err) {
    if (err instanceof GovernanceError) return json({ error: err.message }, err.status);
    return failed("api/enterprise/budgets", err);
  }
}
