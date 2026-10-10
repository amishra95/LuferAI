"use server";

import { refresh, revalidatePath } from "next/cache";

import { requirePortal, type Member } from "@/lib/auth/session";
import { lockOwner, placeBookingRequest } from "@/lib/bookings/place-booking";
import { bookingFormInput, validateBookingForm, type BookingFormField } from "@/lib/bookings/request-schema";
import { runBookingAgent, type AgentBookingOutcome } from "@/lib/bookings/booking-agent";
import { addApprovalComment, decideApproval, findExpenseExport, listApprovals, listBookings, listCompanies, listPortalUsers, listVenues, updateBookingStatus } from "@/lib/data";
import { exportBookingExpense } from "@/lib/finance/export-dispatcher";
import { ActionError, serverDispatch, type ActionResult } from "@/lib/mutations/server";
import type { BookingStatus } from "@/lib/supabase/database.types";
import { publishApproval, publishBooking, publishExpense } from "@/lib/telemetry/live";
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

/**
 * Who may decide an approval, and as whom. Approvers decide their own; admins
 * may decide any pending approval on behalf of its assigned approver. Approver
 * and tenant always come from the session, never the request.
 */
async function approvalScope(member: Member, approvalId: string): Promise<{ approverId: string; tenantId: string }> {
  if (member.role === "CLIENT" && member.companyId) {
    const actor = (await listPortalUsers({ companyId: member.companyId })).find((u) => u.id === member.userId);
    if (actor?.role !== "APPROVER") throw new ActionError("Only users with the Approver role can sign off.");
    return { approverId: member.userId, tenantId: member.companyId };
  }
  if (member.role === "ADMIN") {
    const [pending] = (await listApprovals({ status: "PENDING" })).filter((a) => a.id === approvalId);
    if (pending) return { approverId: pending.approver_id, tenantId: pending.tenant_id };
  }
  throw new ActionError("This approval was not found or has already been decided.");
}

function revalidateBookingViews() {
  revalidatePath("/client");
  revalidatePath("/client/approvals");
  revalidatePath("/property");
  revalidatePath("/admin");
}

export interface SpendDecision {
  approvalId: string;
  bookingId: string;
  decision: "APPROVED" | "REJECTED";
  /** The booking's status after the decision (PENDING once every tier approved). */
  bookingStatus: BookingStatus | null;
  venueId: string;
}

/**
 * Manager / procurement sign-off on an out-of-policy or high-spend request.
 * Tiers stay sequential (a tier-2 approver waits for tier 1). On success the
 * decision is published, and if it moved the booking (to the venue, or
 * cancelled) that is too.
 */
export async function approveEventSpend(approvalId: string, decision: "APPROVED" | "REJECTED", note?: string): Promise<ActionResult<SpendDecision>> {
  return serverDispatch(
    "client/approveEventSpend",
    async () => {
      const member = await requirePortal("/client");
      if (!approvalId || (decision !== "APPROVED" && decision !== "REJECTED")) throw new ActionError("Invalid approval action.");
      const scope = await approvalScope(member, approvalId);
      const [approval] = (await listApprovals({ tenantId: scope.tenantId })).filter((a) => a.id === approvalId);
      try {
        await decideApproval(approvalId, scope, decision, note?.trim().slice(0, 500) || undefined);
      } catch (err) {
        // decideApproval's messages are written for users ("Waiting for tier-1 sign-off from …").
        throw new ActionError(err instanceof Error ? err.message : "Could not record the decision.");
      }
      const booking = approval ? (await listBookings({ companyId: scope.tenantId })).find((b) => b.id === approval.booking_id) : undefined;
      revalidateBookingViews();
      refresh();
      return { approvalId, bookingId: approval?.booking_id ?? "", decision, bookingStatus: booking?.status ?? null, venueId: booking?.venue_id ?? "" };
    },
    {
      emit: async ({ approvalId: id, bookingId, decision: d, bookingStatus, venueId }) => {
        await publishApproval(id, bookingId, d);
        if (bookingStatus && bookingStatus !== "PENDING_APPROVAL") await publishBooking(bookingId, venueId, bookingStatus, "approval");
      },
    }
  );
}

// ----------------------------------------------------------------------------
// Booking agent
// ----------------------------------------------------------------------------

export interface AgentBookingRequest {
  venueId: string | null;
  eventDate: string;
  partySize: number;
  perHead: number;
  maxPerHead: number;
  alcoholIncluded: boolean;
  entertainment: string[];
  privateDining: boolean;
  costCenter: string;
  projectCode?: string;
  notes?: string;
}

/**
 * Hands an event request to the booking agent (lib/bookings/booking-agent.ts):
 * shortlist, availability, negotiated per-head, policy and approvals, and
 * confirmation only for in-policy bookings on pre-agreed corporate terms.
 * Organizers and Approvers book for their own company.
 */
export async function dispatchBookingAgent(request: AgentBookingRequest): Promise<ActionResult<AgentBookingOutcome>> {
  return serverDispatch(
    "client/dispatchBookingAgent",
    async () => {
      const member = await requirePortal("/client");
      if (member.role !== "CLIENT" || !member.companyId) throw new ActionError("The booking agent books for a company: sign in as an Organizer or Approver.");
      const today = new Date().toISOString().slice(0, 10);
      if (!ISO_DATE.test(request.eventDate) || request.eventDate <= today) throw new ActionError("Pick a future date.");
      if (!Number.isInteger(request.partySize) || request.partySize < 1 || request.partySize > 2000) throw new ActionError("Enter a whole number of guests.");
      if (!(request.perHead > 0) || !(request.maxPerHead >= request.perHead) || request.maxPerHead > 1_000_000) {
        throw new ActionError("Enter a per-head budget, and a ceiling at least as high.");
      }
      if (!request.costCenter?.trim()) throw new ActionError("Enter a cost centre for finance.");
      const entertainment = (request.entertainment ?? []).filter((e) => typeof e === "string" && /^[a-z_]{1,24}$/.test(e)).slice(0, 8);

      const outcome = await runBookingAgent({
        venueId: request.venueId || null,
        eventDate: request.eventDate,
        partySize: request.partySize,
        perHead: request.perHead,
        maxPerHead: request.maxPerHead,
        alcoholIncluded: Boolean(request.alcoholIncluded),
        entertainment,
        privateDining: Boolean(request.privateDining),
        companyId: member.companyId,
        userId: member.userId,
        expense: { costCenter: request.costCenter.trim(), projectCode: request.projectCode?.trim() || null },
        notes: request.notes?.trim().slice(0, 500) || undefined,
      });
      // The agent's own failures (no venue, over the ceiling) are results, not errors: the steps explain them.
      if (outcome.bookingId) {
        revalidateBookingViews();
        refresh();
      }
      return outcome;
    },
    {
      emit: (o) =>
        o.bookingId && o.venueId
          ? publishBooking(o.bookingId, o.venueId, o.status === "confirmed" ? "CONFIRMED" : o.status === "awaiting_approval" ? "PENDING_APPROVAL" : "PENDING", "agent")
          : undefined,
    }
  );
}

// ----------------------------------------------------------------------------
// Expense management
// ----------------------------------------------------------------------------

export interface ExpenseSync {
  bookingId: string;
  provider: string;
  export: "delivered" | "mocked" | "failed" | "skipped";
  /** Set when the sync also settled a completed booking. */
  settled: boolean;
  venueId: string;
  error?: string;
}

/**
 * Connects a booking to the company's expense system (Ramp, Brex, Concur or a
 * signed webhook; lib/finance/expense-adapters.ts): exports it if it hasn't
 * been, retries a failed export, and once the event is COMPLETED and the
 * expense is recorded, marks the booking SETTLED with the export as reference.
 * Admins, and Approvers for their own company.
 */
export async function syncExpenseManagement(bookingId: string): Promise<ActionResult<ExpenseSync>> {
  return serverDispatch(
    "client/syncExpenseManagement",
    async () => {
      const member = await requirePortal("/client");
      let companyId: string | undefined;
      if (member.role === "CLIENT") {
        const actor = member.companyId ? (await listPortalUsers({ companyId: member.companyId })).find((u) => u.id === member.userId) : undefined;
        if (actor?.role !== "APPROVER") throw new ActionError("Only Approvers (or admins) can sync bookings to the expense system.");
        companyId = member.companyId!;
      } else if (member.role !== "ADMIN") {
        throw new ActionError("You can't sync expenses.");
      }
      const booking = (await listBookings(companyId ? { companyId } : {})).find((b) => b.id === bookingId);
      if (!booking) throw new ActionError("Booking not found.");
      if (!["CONFIRMED", "COMPLETED", "SETTLED"].includes(booking.status)) throw new ActionError("Only confirmed bookings can be synced to expenses.");

      const result = await exportBookingExpense(bookingId);
      if (result.status === "failed" && !result.provider) throw new ActionError(result.error);
      const provider = result.provider ?? "webhook";
      let settled = false;
      if (booking.status === "COMPLETED" && result.status !== "failed") {
        const exp = await findExpenseExport(bookingId, "booking.confirmed");
        await updateBookingStatus(bookingId, "SETTLED", { companyId: booking.company_id, expenseReference: exp ? `${provider}:${exp.id}` : null });
        settled = true;
      }
      revalidateBookingViews();
      refresh();
      return { bookingId, provider, export: result.status, settled, venueId: booking.venue_id, ...(result.status === "failed" && { error: result.error }) };
    },
    {
      emit: async ({ bookingId: id, provider, export: status, settled, venueId }) => {
        await publishExpense(id, provider, status);
        if (settled) await publishBooking(id, venueId, "SETTLED", "expense");
      },
    }
  );
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
