"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { parseDealsCsv, PROVIDER_LABEL } from "@/lib/crm/deals";
import { dealsAvailable, listDeals, setBookingDeal, upsertDeals } from "@/lib/crm/store";
import { listBookings, listPortalUsers } from "@/lib/data";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";

/** 2 MB: tens of thousands of deals, far past MAX_IMPORT_ROWS. */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

/** Organizers and Approvers of their own company; admins view this portal read-only. */
async function editor() {
  const member = await requirePortal("/client");
  if (member.role !== "CLIENT" || !member.companyId) throw new ActionError("Platform admins view this portal read-only.");
  const actor = (await listPortalUsers({ companyId: member.companyId })).find((u) => u.id === member.userId);
  if (actor?.role !== "ORGANIZER" && actor?.role !== "APPROVER") throw new ActionError("Only Organizers and Approvers can manage deals.");
  if (!dealsAvailable()) throw new ActionError("Deals aren't available in this environment.");
  return { companyId: member.companyId };
}

export interface ImportResult {
  provider: string;
  imported: number;
  errors: { line: number; error: string }[];
}

/** Imports a deals CSV exported from Zoho CRM, HubSpot or Salesforce. Re-importing updates existing deals. */
export async function importDealsCsv(_prev: ActionResult<ImportResult> | null, formData: FormData): Promise<ActionResult<ImportResult>> {
  return serverDispatch("client/importDealsCsv", async () => {
    const { companyId } = await editor();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Choose a CSV file to import.");
    if (file.size > MAX_CSV_BYTES) throw new ActionError("That file is over 2 MB. Export only open and recently closed deals.");
    const parsed = parseDealsCsv(await file.text());
    if (parsed.deals.length === 0) throw new ActionError(parsed.errors[0]?.error ?? "No deals found in the file.");
    const imported = await upsertDeals(companyId, parsed.deals);
    revalidatePath("/client/roi");
    return { provider: PROVIDER_LABEL[parsed.provider], imported, errors: parsed.errors.slice(0, 20) };
  });
}

/** Links a booking to the deal it entertained for (or unlinks it with an empty dealId). */
export async function linkBookingToDeal(bookingId: string, dealId: string): Promise<ActionResult<{ bookingId: string; dealId: string | null }>> {
  return serverDispatch("client/linkBookingToDeal", async () => {
    const { companyId } = await editor();
    const booking = (await listBookings({ companyId })).find((b) => b.id === bookingId);
    if (!booking) throw new ActionError("Booking not found.");
    const next = dealId || null;
    if (next && !(await listDeals(companyId)).some((d) => d.id === next)) throw new ActionError("Deal not found.");
    await setBookingDeal(bookingId, companyId, next);
    revalidatePath("/client/roi");
    return { bookingId, dealId: next };
  });
}
