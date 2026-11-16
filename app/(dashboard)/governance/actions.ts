"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { canManageGovernance, governedCompany } from "@/lib/services/enterprise/access";
import { CompanySetupInput } from "@/lib/companies/setup";
import { saveCompanySetup } from "@/lib/companies/setup-store";
import { addCompanyGstin, dataSource, listCompanies } from "@/lib/data";
import { issueWaitingInvoices } from "@/lib/finance/billing-sweep";
import { GSTIN_TAKEN } from "@/lib/companies/gstin";
import { validateGstin } from "@/lib/gst-engine";
import { TeamInvite } from "@/lib/companies/team";
import { inviteTeammate, removeTeammate, TeamError } from "@/lib/companies/team-store";
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

/** Office area and per-head approval tiers (components/governance/company-setup.tsx). */
export async function companySetupAction(companyId: string | null, input: CompanySetupInput): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("governance/company-setup", async () => {
    const { member, company } = await scope(companyId);
    if (!canManageGovernance(member)) throw new ActionError("Only Approvers and platform admins can change company setup.");
    if (dataSource() !== "supabase") throw new ActionError("Company setup needs the live database.");
    const parsed = CompanySetupInput.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    // GSTIN: added once if the company has none; changing a set one stays with Lufer.
    if (parsed.data.gstin) {
      if (!validateGstin(parsed.data.gstin).valid) throw new ActionError("That GSTIN isn't valid. Check the 15 characters.");
      const added = await addCompanyGstin(company, parsed.data.gstin);
      if (added === "taken") throw new ActionError(GSTIN_TAKEN);
    }
    const hadAddress = Boolean((await listCompanies()).find((c) => c.id === company)?.billing_address);
    await saveCompanySetup(company, parsed.data);
    // Invoices waiting for the address go out now rather than at the next daily sweep.
    if (!hadAddress && parsed.data.billingAddress) after(() => issueWaitingInvoices(company));
    revalidateGovernance();
    revalidatePath("/venues");
    return { ok: true as const };
  });
}

/** Team (components/governance/team-manager.tsx): Approvers invite and remove colleagues. */
async function teamScope(companyId: string | null) {
  const { member, company } = await scope(companyId);
  if (!canManageGovernance(member)) throw new ActionError("Only Approvers can manage the team.");
  return { member, company };
}

const asTeamAction = (err: unknown): never => {
  if (err instanceof TeamError) throw new ActionError(err.message);
  throw err;
};

export async function inviteTeammateAction(companyId: string | null, input: { email: string; role: string }): Promise<ActionResult<{ email: string; emailed: boolean }>> {
  return serverDispatch("governance/team-invite", async () => {
    const { member, company } = await teamScope(companyId);
    const parsed = TeamInvite.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const row = (await listCompanies()).find((c) => c.id === company);
    if (!row) throw new ActionError("Company not found.");
    const { emailed } = await inviteTeammate(row, member.email ?? "Your colleague", parsed.data).catch(asTeamAction);
    revalidateGovernance();
    return { email: parsed.data.email, emailed };
  });
}

export async function removeTeammateAction(companyId: string | null, userId: string): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("governance/team-remove", async () => {
    const { member, company } = await teamScope(companyId);
    await removeTeammate(company, member.userId, userId).catch(asTeamAction);
    revalidateGovernance();
    return { ok: true as const };
  });
}
