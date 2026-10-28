"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/lib/auth/session";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { createPunchoutConnection, PunchoutError, updatePunchoutConnection } from "@/lib/punchout/store";
import { governedCompany } from "@/lib/services/enterprise/access";

/**
 * cXML PunchOut connections (lib/punchout/store.ts). Platform admins only:
 * the shared secret is returned once, to give to the buyer's procurement team.
 * `companyId` is the company being viewed on /governance.
 */
async function punchoutScope(companyId: string | null) {
  const member = await requireWorkspace("/governance");
  if (member.role !== "ADMIN") throw new ActionError("Only Lufer admins can change PunchOut connections.");
  const company = governedCompany(member, companyId);
  if (!company) throw new ActionError("Choose a company first.");
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
