"use server";

import { revalidatePath } from "next/cache";

import { placeBookingRequest, type BookingField } from "@/lib/bookings/place-booking";
import { addApprovalComment, decideApproval, listCompanies, listPortalUsers, listVenues } from "@/lib/data";
import type { TaxInvoicePayload } from "@/lib/gst-engine";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { getNegotiatedRate, type NegotiatedPricing } from "@/lib/rates/getNegotiatedRate";

export interface BookingRequestState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<BookingField, string>>;
  invoice?: TaxInvoicePayload;
  /** Set when the booking breached policy and is waiting for sign-off (tiers: 1 manager, 2 manager + senior). */
  approval?: { reason: string; approverName: string; tiers: number };
  /** How long the venue/date is held for this booking. */
  holdHours?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AVAILABILITY_WINDOW_DAYS = 180;

/**
 * Dates in the next ~6 months on which a venue is locked (live hold or
 * confirmed booking). Returns dates only: who holds them stays private.
 */
export async function getUnavailableDates(venueId: string): Promise<string[]> {
  const venues = await listVenues();
  if (!venues.some((v) => v.id === venueId)) return [];
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + AVAILABILITY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { locks } = await checkHoldAvailability({ venue_id: venueId, from, to });
  return [...new Set(locks.map((l) => l.date))];
}

/** Live price preview for the request form: the tenant's negotiated terms at a venue. */
export async function previewNegotiatedRate(input: {
  companyId: string;
  venueId: string;
  eventDate: string;
  partySize: number;
  perHead: number;
}): Promise<NegotiatedPricing | null> {
  const { companyId, venueId, eventDate, partySize, perHead } = input;
  if (!ISO_DATE.test(eventDate) || !Number.isInteger(partySize) || partySize < 1 || !(perHead > 0)) return null;
  const [companies, venues] = await Promise.all([listCompanies(), listVenues()]);
  if (!companies.some((c) => c.id === companyId) || !venues.some((v) => v.id === venueId)) return null;
  return getNegotiatedRate({ tenant_id: companyId, venue_id: venueId, event_date: eventDate, party_size: partySize, per_head_amount: perHead });
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
  const expense = {
    costCenter: String(formData.get("cost_center") ?? ""),
    projectCode: String(formData.get("project_code") ?? ""),
    taxId: String(formData.get("billing_gstin") ?? ""),
  };

  const result = await placeBookingRequest({ companyId, userId, venueId, eventDate, partySize, budgetPerHead, notes, expense });
  if (result.status === "success") {
    revalidatePath("/client");
    revalidatePath("/property");
    revalidatePath("/admin");
  }
  return result;
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

  // Only Approvers decide; the chain assignment below scopes it to their own approvals.
  const actor = (await listPortalUsers({ companyId })).find((u) => u.id === userId);
  if (actor?.role !== "APPROVER") return { status: "error", message: "Only users with the Approver role can sign off." };

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

export interface ApprovalCommentState {
  status: "idle" | "success" | "error";
  message?: string;
}

/** Posts to an approval's discussion thread as the acting user (any role in the tenant). */
export async function postApprovalComment(_prev: ApprovalCommentState, formData: FormData): Promise<ApprovalCommentState> {
  const approvalId = String(formData.get("approval_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!approvalId || !companyId || !userId) return { status: "error", message: "Invalid comment." };
  if (body.length < 1 || body.length > 2000) return { status: "error", message: "Write a comment (up to 2000 characters)." };

  try {
    await addApprovalComment({ approvalId, tenantId: companyId, authorId: userId, body });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not post the comment." };
  }
  revalidatePath("/client");
  return { status: "success" };
}
