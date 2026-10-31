"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requirePortal } from "@/lib/auth/session";
import { decideSignupApplication, getSignupApplication, publishVenue, SignupApplicationError } from "@/lib/data";
import { notifyApplicationDecision } from "@/lib/services/notifications";

const PORTAL_NAME: Record<string, string> = { enterprise: "client", venue: "property", partner: "partner" };

export type DecisionResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Platform admins only (the /admin portal); every action re-checks. */
async function decide(userId: string, decision: "active" | "rejected", reason?: string): Promise<DecisionResult> {
  const member = await requirePortal("/admin");
  if (member.role !== "ADMIN") return { ok: false, error: "Only platform admins can approve accounts." };
  if (!UUID.test(userId)) return { ok: false, error: "Unknown applicant." };
  const application = await getSignupApplication(userId);
  if (!application) return { ok: false, error: "This application was not found." };
  try {
    const decided = await decideSignupApplication(application.id, decision, member.userId, reason?.trim().slice(0, 500) || null);
    // The applicant hears either way, after the response; a failed email doesn't undo the decision.
    const email = notifyApplicationDecision(decided);
    try {
      after(email);
    } catch {
      // Outside a request (tests, scripts): the promise still runs.
    }
    revalidatePath("/admin/approvals");
    revalidatePath("/admin");
    return {
      ok: true,
      message:
        decision === "active"
          ? `${decided.full_name} is approved: they'll land in the ${PORTAL_NAME[decided.account_type] ?? "client"} portal when they sign in.`
          : `${decided.full_name}'s application was rejected.`,
    };
  } catch (err) {
    if (err instanceof SignupApplicationError) return { ok: false, error: err.message };
    console.error("admin/approvals:", err);
    return { ok: false, error: "That didn't work. Try again." };
  }
}

/** Approves an applicant: their company or partner organisation and portal access are created. */
export async function approveUser(userId: string): Promise<DecisionResult> {
  return decide(userId, "active");
}

/** Rejects an applicant, optionally saying why (they see it on /signup/pending and in the email). */
export async function rejectUser(userId: string, reason?: string): Promise<DecisionResult> {
  return decide(userId, "rejected", reason);
}

/** Lists a self-serve venue for companies to find and book, once an admin has checked it's real. */
export async function publishVenueAction(venueId: string): Promise<DecisionResult> {
  const member = await requirePortal("/admin");
  if (member.role !== "ADMIN") return { ok: false, error: "Only platform admins can publish venues." };
  if (!UUID.test(venueId)) return { ok: false, error: "Unknown venue." };
  try {
    const venue = await publishVenue(venueId);
    if (!venue) return { ok: false, error: "This venue was not found." };
    revalidatePath("/admin/approvals");
    return { ok: true, message: `${venue.name} is live: companies can now find and book it.` };
  } catch (err) {
    console.error("admin/approvals: publish venue", err);
    return { ok: false, error: "That didn't work. Try again." };
  }
}
