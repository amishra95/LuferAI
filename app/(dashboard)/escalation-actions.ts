"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/lib/auth/session";
import { decideEscalation } from "@/lib/escalations/decide";
import { parseWhatsAppNumber } from "@/lib/escalations/rules";
import { EscalationError, saveVenueAlertNumber, type Escalation } from "@/lib/escalations/store";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";

/**
 * Escalation queue actions, shared by /property (the venue's host, own venue
 * only) and /agents (admins, every venue). Authorisation is checked again in
 * lib/escalations/decide.ts.
 */

async function reviewer() {
  const member = await getCurrentMember();
  if (!member || (member.role !== "ADMIN" && member.role !== "PROPERTY")) throw new ActionError("Only venue hosts and admins can review escalations.");
  return member;
}

function revalidateQueues() {
  revalidatePath("/property");
  revalidatePath("/agents");
  revalidatePath("/client");
}

/** Approve the held-back counter, send it at another price, or reject it. */
export async function decideEscalationAction(id: string, input: { action: string; perHead?: string; note?: string }): Promise<ActionResult<Escalation>> {
  return serverDispatch("escalations/decide", async () => {
    const member = await reviewer();
    const escalation = await decideEscalation(id, input, member).catch((err: unknown) => {
      if (err instanceof EscalationError) throw new ActionError(err.message);
      throw err;
    });
    revalidateQueues();
    return escalation;
  });
}

/** The host's WhatsApp number for escalation alerts (blank turns them off). Admins pass the venue. */
export async function saveAlertNumberAction(venueId: string, phone: string): Promise<ActionResult<{ phone: string | null }>> {
  return serverDispatch("escalations/saveAlertNumber", async () => {
    const member = await reviewer();
    const target = member.role === "ADMIN" ? venueId : member.venueId;
    if (!target) throw new ActionError("Choose a venue.");
    const parsed = parseWhatsAppNumber(phone);
    if (!parsed.ok) throw new ActionError(parsed.error);
    await saveVenueAlertNumber(target, parsed.value, member.userId).catch((err: unknown) => {
      if (err instanceof EscalationError) throw new ActionError(err.message);
      throw err;
    });
    revalidatePath("/property");
    return { phone: parsed.value };
  });
}
