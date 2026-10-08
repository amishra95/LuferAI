"use server";

import { revalidatePath } from "next/cache";

import { requirePortal, type Member } from "@/lib/auth/session";
import { lockOwner, placeBookingRequest } from "@/lib/bookings/place-booking";
import { bookingFormInput, validateBookingForm, type BookingFormField } from "@/lib/bookings/request-schema";
import { addApprovalComment, decideApproval, listApprovals, listCompanies, listPortalUsers, listVenues } from "@/lib/data";
import type { TaxInvoicePayload } from "@/lib/gst-engine";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { CHECKOUT_LOCK_TTL_MS, getSlotLocks, ownerOf } from "@/lib/locks";
import { getNegotiatedRate, type NegotiatedPricing } from "@/lib/rates/getNegotiatedRate";

export interface BookingRequestState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<BookingFormField, string>>;
  invoice?: TaxInvoicePayload;
  /** Set when the booking breached policy and is waiting for sign-off (tiers: 1 manager, 2 manager + senior). */
  approval?: { reason: string; approverName: string; tiers: number };
  /** How long the venue/date is held for this booking. */
  holdHours?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AVAILABILITY_WINDOW_DAYS = 180;

/**
 * The tenant a request acts for. Never trust a submitted company: clients act for
 * their own, and only admins may act for another company.
 */
function tenantFor(member: Member, submitted: FormDataEntryValue | string | null): string {
  return member.role === "ADMIN" ? String(submitted ?? "") : member.companyId ?? "";
}

/**
 * Dates in the next ~6 months on which a venue is locked (live hold or
 * confirmed booking). Returns dates only: who holds them stays private.
 */
export async function getUnavailableDates(venueId: string): Promise<string[]> {
  await requirePortal("/client");
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
  const member = await requirePortal("/client");
  const { venueId, eventDate, partySize, perHead } = input;
  // A client only ever previews their own company's negotiated terms.
  const companyId = tenantFor(member, input.companyId);
  if (!ISO_DATE.test(eventDate) || !Number.isInteger(partySize) || partySize < 1 || !(perHead > 0)) return null;
  const [companies, venues] = await Promise.all([listCompanies(), listVenues()]);
  if (!companies.some((c) => c.id === companyId) || !venues.some((v) => v.id === venueId)) return null;
  return getNegotiatedRate({ tenant_id: companyId, venue_id: venueId, event_date: eventDate, party_size: partySize, per_head_amount: perHead });
}

export async function submitBookingRequest(
  _prev: BookingRequestState,
  formData: FormData
): Promise<BookingRequestState> {
  const member = await requirePortal("/client");
  // The requester is the signed-in employee (admins can't request sign-off for a company).
  const companyId = tenantFor(member, formData.get("company_id"));
  const userId = member.role === "CLIENT" ? member.userId : "";

  // Same schema the form validates with step by step; this pass is authoritative.
  // Checks that need data (capacity, minimum spend, the company's GSTIN, policy) run in placeBookingRequest.
  const parsed = validateBookingForm(bookingFormInput(formData), { today: new Date().toISOString().slice(0, 10) });
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors, message: "Please fix the highlighted fields." };
  const v = parsed.value;

  const result = await placeBookingRequest({
    companyId,
    userId,
    venueId: v.venue_id,
    eventDate: v.event_date,
    partySize: v.party_size,
    budgetPerHead: v.budget_per_head_inr,
    notes: v.notes,
    departmentId: v.department_id,
    expense: { costCenter: v.cost_center, projectCode: v.project_code, taxId: v.billing_gstin },
    checkoutToken: String(formData.get("slot_token") ?? "") || null,
  });
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
  const member = await requirePortal("/client");
  const approvalId = String(formData.get("approval_id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || undefined;
  if (!approvalId || (intent !== "approve" && intent !== "reject")) {
    return { status: "error", message: "Invalid approval action." };
  }

  // Approver and tenant come from the session. Admins may decide any pending
  // approval, on behalf of its assigned approver.
  let scope: { approverId: string; tenantId: string } | null = null;
  if (member.role === "CLIENT" && member.companyId) {
    // Only Approvers decide; the scope below limits it to their own approvals.
    const actor = (await listPortalUsers({ companyId: member.companyId })).find((u) => u.id === member.userId);
    if (actor?.role !== "APPROVER") return { status: "error", message: "Only users with the Approver role can sign off." };
    scope = { approverId: member.userId, tenantId: member.companyId };
  } else if (member.role === "ADMIN") {
    const [pending] = (await listApprovals({ status: "PENDING" })).filter((a) => a.id === approvalId);
    if (pending) scope = { approverId: pending.approver_id, tenantId: pending.tenant_id };
  }
  if (!scope) return { status: "error", message: "This approval was not found or has already been decided." };

  try {
    // Scoped to approver + tenant so nobody can decide someone else's approval.
    await decideApproval(approvalId, scope, intent === "approve" ? "APPROVED" : "REJECTED", note);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not record the decision." };
  }

  revalidatePath("/client");
  revalidatePath("/client/approvals");
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
  const member = await requirePortal("/client");
  // Comments are posted as the signed-in employee, in their own company's threads.
  if (member.role !== "CLIENT" || !member.companyId) return { status: "error", message: "Only company employees can comment." };
  const companyId = member.companyId;
  const userId = member.userId;
  const approvalId = String(formData.get("approval_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!approvalId) return { status: "error", message: "Invalid comment." };
  if (body.length < 1 || body.length > 2000) return { status: "error", message: "Write a comment (up to 2000 characters)." };

  try {
    await addApprovalComment({ approvalId, tenantId: companyId, authorId: userId, body });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not post the comment." };
  }
  revalidatePath("/client");
  revalidatePath("/client/approvals");
  return { status: "success" };
}

export type CheckoutSlotState =
  | { status: "held"; token: string; expiresAt: number }
  | { status: "busy"; retryAfterMs: number }
  | { status: "unavailable" };

/**
 * Starts (or refreshes) a checkout session: locks the venue/date for this
 * employee for CHECKOUT_LOCK_TTL_MS while they finish the form, so two people
 * can't race for the same slot. Submitting the form consumes the lock.
 */
export async function reserveCheckoutSlot(venueId: string, eventDate: string): Promise<CheckoutSlotState> {
  const member = await requirePortal("/client");
  if (member.role !== "CLIENT" || !member.companyId) return { status: "unavailable" };
  const today = new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(eventDate) || eventDate <= today) return { status: "unavailable" };
  if (!(await listVenues()).some((v) => v.id === venueId)) return { status: "unavailable" };

  try {
    const r = await getSlotLocks().locks.acquire({ venueId, date: eventDate }, lockOwner(member.companyId, member.userId), CHECKOUT_LOCK_TTL_MS);
    return r.ok ? { status: "held", token: r.token, expiresAt: r.expiresAt } : { status: "busy", retryAfterMs: r.retryAfterMs };
  } catch (err) {
    // Lock store down: the form still works; the database hold check still applies.
    console.error("checkout: slot lock unavailable", err);
    return { status: "unavailable" };
  }
}

/** Ends the caller's own checkout session early (they picked another date or venue). */
export async function releaseCheckoutSlot(venueId: string, eventDate: string, token: string): Promise<void> {
  const member = await requirePortal("/client");
  if (member.role !== "CLIENT" || !member.companyId || ownerOf(token) !== lockOwner(member.companyId, member.userId)) return;
  if (!ISO_DATE.test(eventDate)) return;
  await getSlotLocks()
    .locks.release({ venueId, date: eventDate }, token)
    .catch((err) => console.error("checkout: release failed", err));
}
