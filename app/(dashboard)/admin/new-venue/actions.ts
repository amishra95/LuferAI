"use server";

import { revalidatePath } from "next/cache";

import { quickAddVenue, QuickAddError, type QuickAddResult } from "@/lib/admin/venue-quick-add-store";
import { VenueQuickAdd, type VenueQuickAddInput } from "@/lib/admin/venue-quick-add";
import { requirePortal } from "@/lib/auth/session";
import { siteUrl } from "@/lib/site-url";

export type QuickAddState = { ok: true; result: QuickAddResult; name: string } | { ok: false; error: string; field?: string };

/** Lufer admins only (the /admin portal); see lib/admin/venue-quick-add.ts. */
export async function quickAddVenueAction(input: VenueQuickAddInput): Promise<QuickAddState> {
  const member = await requirePortal("/admin");
  if (member.role !== "ADMIN") return { ok: false, error: "Only Lufer admins can add venues." };
  const parsed = VenueQuickAdd.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form.", field: issue ? String(issue.path[0]) : undefined };
  }
  try {
    const result = await quickAddVenue(parsed.data, new URL("/auth/callback?next=/property", siteUrl("https://lufer.app")).toString());
    revalidatePath("/venues");
    revalidatePath("/client");
    revalidatePath("/admin/approvals");
    return { ok: true, result, name: parsed.data.name };
  } catch (err) {
    if (err instanceof QuickAddError) return { ok: false, error: err.message };
    console.error("admin/new-venue:", err);
    return { ok: false, error: "That didn't save. Try again." };
  }
}
