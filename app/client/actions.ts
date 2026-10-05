"use server";

import { revalidatePath } from "next/cache";

import {
  createBookingRequest,
  decideApproval,
  listApprovalChain,
  listCompanies,
  listPortalUsers,
  listVenues,
  type NewApprovalRequest,
} from "@/lib/data";
import { roundInr, type TaxInvoicePayload } from "@/lib/gst-engine";
import { checkBookingPolicy } from "@/lib/policies/checkBookingPolicy";

export interface BookingRequestState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<"venue_id" | "event_date" | "party_size" | "budget_per_head_inr", string>>;
  invoice?: TaxInvoicePayload;
  /** Set when the booking breached policy and is waiting on a manager. */
  approval?: { reason: string; approverName: string };
}

export async function submitBookingRequest(
  _prev: BookingRequestState,
  formData: FormData
): Promise<BookingRequestState> {
  const companyId = String(formData.get("company_id") ?? "");
  // Until sign-in exists, the acting employee comes from the page's ?user= switcher.
  const userId = String(formData.get("user_id") ?? "");
  const venueId = String(formData.get("venue_id") ?? "");
  const eventDate = String(formData.get("event_date") ?? "");
  const partySize = Number(formData.get("party_size"));
  const budgetPerHead = Number(formData.get("budget_per_head_inr"));
  const notes = String(formData.get("notes") ?? "").trim() || undefined;

  const [companies, venues] = await Promise.all([listCompanies(), listVenues()]);
  const company = companies.find((c) => c.id === companyId);
  const venue = venues.find((v) => v.id === venueId);

  const fieldErrors: BookingRequestState["fieldErrors"] = {};
  if (!venue) fieldErrors.venue_id = "Choose a venue";
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate <= today) fieldErrors.event_date = "Pick a future date";
  if (!Number.isInteger(partySize) || partySize < 1) fieldErrors.party_size = "Enter a whole number of guests";
  else if (venue && partySize > venue.capacity_max) fieldErrors.party_size = `${venue.name} seats up to ${venue.capacity_max}`;
  if (!Number.isFinite(budgetPerHead) || budgetPerHead <= 0) fieldErrors.budget_per_head_inr = "Enter a budget per head";
  else if (venue && partySize > 0 && partySize * budgetPerHead < Number(venue.min_spend_inr)) {
    fieldErrors.budget_per_head_inr = `Below ${venue.name}'s minimum spend of ₹${Number(venue.min_spend_inr).toLocaleString("en-IN")}`;
  }

  if (!company) return { status: "error", message: "Unknown company account." };
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors, message: "Please fix the highlighted fields." };

  try {
    const policy = await checkBookingPolicy({
      tenant_id: company.id,
      total_amount: roundInr(partySize * budgetPerHead),
      headcount: partySize,
      per_head_amount: budgetPerHead,
    });

    let approval: NewApprovalRequest | undefined;
    let approverName = "";
    if (policy.requiresApproval) {
      const [users, chain] = await Promise.all([listPortalUsers({ companyId: company.id }), listApprovalChain(company.id)]);
      if (!users.some((u) => u.id === userId)) {
        return { status: "error", message: `This booking needs sign-off (${policy.reason}). Choose who is requesting it under "Acting as" first.` };
      }
      // Tier 1 approves; if the requester is tier 1 themselves, the next tier does.
      const tier = chain.find((c) => c.approver_user_id !== userId);
      if (!tier) {
        return {
          status: "error",
          message: `This booking needs sign-off (${policy.reason}), but ${company.legal_name} has no approver set up${chain.length ? " other than you" : ""}.`,
        };
      }
      approval = { requested_by: userId, approver_id: tier.approver_user_id, reason: policy.reason };
      approverName = users.find((u) => u.id === tier.approver_user_id)?.name ?? "your approver";
    }

    const booking = await createBookingRequest(
      {
        company_id: company.id,
        venue_id: venue!.id,
        party_size: partySize,
        budget_per_head_inr: budgetPerHead,
        event_date: eventDate,
        notes,
      },
      approval
    );
    revalidatePath("/client");
    revalidatePath("/property");
    revalidatePath("/admin");

    if (approval) {
      return {
        status: "success",
        message: "Booking submitted — requires manager sign-off.",
        invoice: booking.invoice,
        approval: { reason: approval.reason, approverName },
      };
    }
    return {
      status: "success",
      message: `Request sent to ${venue!.name}. You'll see it update here once the venue responds.`,
      invoice: booking.invoice,
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not create the booking." };
  }
}

export interface ApprovalDecisionState {
  status: "idle" | "error";
  message?: string;
}

/** Approve or reject a booking approval as the acting approver. */
export async function decideBookingApproval(
  _prev: ApprovalDecisionState,
  formData: FormData
): Promise<ApprovalDecisionState> {
  const approvalId = String(formData.get("approval_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (!approvalId || !userId || !companyId || (intent !== "approve" && intent !== "reject")) {
    return { status: "error", message: "Invalid approval action." };
  }

  try {
    // Scoped to approver + tenant so nobody can decide someone else's approval.
    await decideApproval(approvalId, { approverId: userId, tenantId: companyId }, intent === "approve" ? "APPROVED" : "REJECTED", note);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not record the decision." };
  }

  revalidatePath("/client");
  revalidatePath("/property");
  revalidatePath("/admin");
  return { status: "idle" };
}
