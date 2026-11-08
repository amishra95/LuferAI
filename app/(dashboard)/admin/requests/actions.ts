"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { updateConciergeRequest } from "@/lib/concierge/request-store";
import { RequestUpdate, type RequestUpdateInput } from "@/lib/concierge/requests";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";

/** Status and the note the requester sees. Platform admins only. */
export async function updateRequestAction(input: RequestUpdateInput): Promise<ActionResult<{ ok: true }>> {
  return serverDispatch("admin/requests-update", async () => {
    const member = await requirePortal("/admin");
    if (member.role !== "ADMIN") throw new ActionError("Only Lufer admins work the request queue.");
    const parsed = RequestUpdate.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    if (!(await updateConciergeRequest(parsed.data))) throw new ActionError("That request wasn't found.");
    revalidatePath("/admin/requests");
    revalidatePath("/client");
    return { ok: true as const };
  });
}
