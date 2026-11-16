"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { getConciergeRequest, quoteConciergeRequest, updateConciergeRequest } from "@/lib/concierge/request-store";
import { isQuotable, QuoteInput, quoteEmail, RequestUpdate, type RequestUpdateInput } from "@/lib/concierge/requests";
import { todayInIndia } from "@/lib/gst-engine";
import { sendRequesterEmail } from "@/lib/services/notifications";
import { siteUrl } from "@/lib/site-url";
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

/**
 * Sends the venue's price to the company: the request becomes 'quoted' with
 * the venue, date, guests and all-in total, and the requester is emailed a
 * link to accept it. Sending again replaces the quote until it's accepted.
 * Platform admins only. `emailed`: whether the requester's email went out
 * (the quote shows on their Home either way).
 */
export async function sendQuoteAction(input: QuoteInput): Promise<ActionResult<{ emailed: boolean }>> {
  return serverDispatch("admin/requests-quote", async () => {
    const member = await requirePortal("/admin");
    if (member.role !== "ADMIN") throw new ActionError("Only Lufer admins send quotes.");
    const parsed = QuoteInput.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Check the quote and try again.");
    if (parsed.data.eventDate < todayInIndia()) throw new ActionError("The event date has passed. Pick the date the venue quoted for.");

    const current = await getConciergeRequest(parsed.data.id);
    if (!current) throw new ActionError("That request wasn't found.");
    if (!current.company_id) throw new ActionError("This request has no company (an admin test), so there's nobody to accept a quote.");
    if (!isQuotable(current.status)) throw new ActionError(current.status === "booked" ? "The company already accepted a quote on this request." : "This request is closed.");

    const quoted = await quoteConciergeRequest(parsed.data);
    if (!quoted) throw new ActionError("This request changed just now. Reload and try again.");

    const link = new URL("/client", siteUrl("https://lufer.app")).toString();
    const sent = await sendRequesterEmail(quoted.requester_email, quoteEmail(quoted, link));
    if (sent.status !== "sent") console.warn("quote: requester email not sent", "reason" in sent ? sent.reason : sent.error);
    revalidatePath("/admin/requests");
    revalidatePath("/client");
    return { emailed: sent.status === "sent" };
  });
}
