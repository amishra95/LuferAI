"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { governedCompany } from "@/lib/services/enterprise/access";
import { ApprovalCommand, BudgetCommand, runApprovalCommand, runBudgetCommand, type ApprovalCommandResult, type BudgetCommandResult } from "@/lib/services/enterprise/commands";
import { GovernanceError } from "@/lib/services/enterprise/governanceStore";

/**
 * /governance actions: the same commands as POST /api/enterprise/approvals and
 * /api/enterprise/budgets (lib/services/enterprise/commands.ts), which check who
 * may change what. `companyId` only counts for admins; clients always act on
 * their own company.
 */

const asAction = (err: unknown): never => {
  if (err instanceof GovernanceError) throw new ActionError(err.message);
  throw err;
};

function revalidateGovernance() {
  revalidatePath("/governance");
  revalidatePath("/client/approvals");
  revalidatePath("/client");
}

async function scope(companyId: string | null) {
  const member = await requireWorkspace("/governance");
  const company = governedCompany(member, companyId);
  if (!company) throw new ActionError("Choose a company first.");
  return { member, company };
}

export async function approvalCommandAction(companyId: string | null, input: ApprovalCommand): Promise<ActionResult<ApprovalCommandResult>> {
  return serverDispatch("governance/approvals", async () => {
    const { member, company } = await scope(companyId);
    const parsed = ApprovalCommand.safeParse(input);
    if (!parsed.success) throw new ActionError("Check the form and try again.");
    const result = await runApprovalCommand(member, company, parsed.data).catch(asAction);
    revalidateGovernance();
    return result;
  });
}

export async function budgetCommandAction(companyId: string | null, input: BudgetCommand): Promise<ActionResult<BudgetCommandResult>> {
  return serverDispatch("governance/budgets", async () => {
    const { member, company } = await scope(companyId);
    const parsed = BudgetCommand.safeParse(input);
    if (!parsed.success) throw new ActionError("Check the form and try again.");
    const result = await runBudgetCommand(member, company, parsed.data).catch(asAction);
    revalidateGovernance();
    return result;
  });
}
