"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { governedCompany } from "@/lib/services/enterprise/access";
import { ApprovalCommand, BudgetCommand, runApprovalCommand, runBudgetCommand, type ApprovalCommandResult, type BudgetCommandResult } from "@/lib/services/enterprise/commands";
import { GovernanceError } from "@/lib/services/enterprise/governanceStore";
import { createPunchoutConnection, PunchoutError, updatePunchoutConnection } from "@/lib/punchout/store";

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

/**
 * cXML PunchOut connections (lib/punchout/store.ts). Platform admins only:
 * the shared secret is returned once, to give to the buyer's procurement team.
 */
async function punchoutScope(companyId: string | null) {
  const { member, company } = await scope(companyId);
  if (member.role !== "ADMIN") throw new ActionError("Only Lufer.ai admins can change PunchOut connections.");
  return company;
}

const asPunchoutAction = (err: unknown): never => {
  if (err instanceof PunchoutError) throw new ActionError(err.message);
  throw err;
};

export async function createPunchoutConnectionAction(companyId: string | null, input: { label: string; senderIdentity: string }): Promise<ActionResult<{ sharedSecret: string; senderIdentity: string }>> {
  return serverDispatch("governance/punchout-create", async () => {
    const company = await punchoutScope(companyId);
    const { connection, sharedSecret } = await createPunchoutConnection(company, input).catch(asPunchoutAction);
    revalidatePath("/governance");
    return { sharedSecret, senderIdentity: connection.sender_identity };
  });
}

export async function updatePunchoutConnectionAction(companyId: string | null, input: { id: string; change: "enable" | "disable" | "remove" }): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("governance/punchout-update", async () => {
    const company = await punchoutScope(companyId);
    await updatePunchoutConnection(company, input.id, input.change).catch(asPunchoutAction);
    revalidatePath("/governance");
    return { ok: true as const };
  });
}
