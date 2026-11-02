"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { governedCompany } from "@/lib/services/enterprise/access";
import { ApprovalCommand, BudgetCommand, runApprovalCommand, runBudgetCommand, type ApprovalCommandResult, type BudgetCommandResult } from "@/lib/services/enterprise/commands";
import { GovernanceError } from "@/lib/services/enterprise/governanceStore";
import { addSsoConnection, removeSsoConnection, setSsoConnectionEnabled, SsoError } from "@/lib/auth/sso-store";

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
 * Enterprise SSO connections (lib/auth/sso-store.ts). Platform admins only:
 * the SAML provider is registered in Supabase Auth first, and its id links here.
 */
async function ssoScope(companyId: string | null) {
  const { member, company } = await scope(companyId);
  if (member.role !== "ADMIN") throw new ActionError("Only Lufer admins can change single sign-on.");
  return company;
}

const asSsoAction = (err: unknown): never => {
  if (err instanceof SsoError) throw new ActionError(err.message);
  throw err;
};

export async function addSsoConnectionAction(companyId: string | null, input: { domain: string; providerId: string; defaultRole: string }): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("governance/sso-add", async () => {
    const company = await ssoScope(companyId);
    await addSsoConnection({ companyId: company, ...input }).catch(asSsoAction);
    revalidatePath("/governance");
    return { ok: true as const };
  });
}

export async function updateSsoConnectionAction(companyId: string | null, input: { id: string; change: "enable" | "disable" | "remove" }): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("governance/sso-update", async () => {
    const company = await ssoScope(companyId);
    if (input.change === "remove") await removeSsoConnection(company, input.id);
    else await setSsoConnectionEnabled(company, input.id, input.change === "enable");
    revalidatePath("/governance");
    return { ok: true as const };
  });
}
