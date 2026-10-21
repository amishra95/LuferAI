"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";

import { getCurrentMember } from "@/lib/auth/session";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import { canManageGovernance, governedCompany } from "@/lib/services/enterprise/access";
import { ContractError, declineContract, getContractBundle, issueContract, setContractsRequired, signContract, voidContract } from "@/lib/services/contracts/contractStore";
import { notifyVenueAccepted } from "@/lib/services/notifications";
import { publishBooking } from "@/lib/telemetry/live";
import type { ContractStatus } from "@/lib/services/contracts/lifecycle";

/**
 * Contract actions for the client portal, the venue portal and /contracts.
 * Who may do what is checked in lib/services/contracts (lifecycle.ts) against
 * the session; ids from the browser only say which record.
 */

async function member() {
  const m = await getCurrentMember();
  if (!m) throw new ActionError("Sign in again to continue.");
  return m;
}

const asAction = (err: unknown): never => {
  if (err instanceof ContractError) throw new ActionError(err.message);
  throw err;
};

function revalidateContracts(contractId?: string) {
  if (contractId) revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/client");
  revalidatePath("/property");
  revalidatePath("/admin");
}

/** Issues the booking's contract from its current terms; returns its id. */
export async function issueContractAction(bookingId: string): Promise<ActionResult<{ id: string }>> {
  return serverDispatch("contracts/issue", async () => {
    const contract = await issueContract(bookingId, await member()).catch(asAction);
    revalidateContracts(contract.id);
    return { id: contract.id };
  });
}

/** Signs as the awaited party. The venue's countersignature confirms the booking. */
export async function signContractAction(
  contractId: string,
  input: { name: string; title?: string; consent: boolean; documentSha256: string }
): Promise<ActionResult<{ status: ContractStatus }>> {
  return serverDispatch("contracts/sign", async () => {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
    const signer = await member();
    const status = await signContract(contractId, signer, { ...input, ip: ip ?? null, userAgent: h.get("user-agent") }).catch(asAction);
    // The venue's countersignature confirms the booking: tell the customer, live and by email.
    if (status === "executed") {
      const booking = (await getContractBundle(contractId, signer))?.booking;
      if (booking?.status === "CONFIRMED") {
        await publishBooking(booking.id, booking.venue_id, "CONFIRMED", "venue", booking.company_id);
        after(() => notifyVenueAccepted(booking.id, booking.venue_id));
      }
    }
    revalidateContracts(contractId);
    return { status };
  });
}

export async function declineContractAction(contractId: string, reason: string): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("contracts/decline", async () => {
    await declineContract(contractId, await member(), reason).catch(asAction);
    revalidateContracts(contractId);
    return { ok: true as const };
  });
}

export async function voidContractAction(contractId: string, reason: string): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("contracts/void", async () => {
    await voidContract(contractId, await member(), reason).catch(asAction);
    revalidateContracts(contractId);
    return { ok: true as const };
  });
}

/** Governance: whether the company confirms bookings by signed contract. Approvers and admins. */
export async function setContractsRequiredAction(companyId: string | null, required: boolean): Promise<ActionResult<{ required: boolean }>> {
  return serverDispatch("contracts/setRequired", async () => {
    const m = await member();
    if (!canManageGovernance(m)) throw new ActionError("Only Approvers and platform admins can change this.");
    const company = governedCompany(m, companyId);
    if (!company) throw new ActionError("Choose a company first.");
    await setContractsRequired(company, required).catch(asAction);
    revalidatePath("/governance");
    revalidateContracts();
    return { required };
  });
}
