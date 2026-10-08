import "server-only";

import {
  createBookingRequest,
  HoldConflictError,
  listApprovalChain,
  listCompanies,
  listDepartments,
  listPortalUsers,
  listVenues,
  type NewApprovalRequest,
} from "@/lib/data";
import { validateExpense, type ExpenseField, type ExpenseInput } from "@/lib/bookings/expense";
import type { TaxInvoicePayload } from "@/lib/gst-engine";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { getSlotLocks } from "@/lib/locks";
import { planHold } from "@/lib/inventory/plan-hold";
import { checkBookingPolicy } from "@/lib/policies/checkBookingPolicy";
import { getNegotiatedRate } from "@/lib/rates/getNegotiatedRate";
import { formatINR } from "@/lib/utils";

export type BookingField = "venue_id" | "event_date" | "party_size" | "budget_per_head_inr" | ExpenseField;

export interface PlaceBookingInput {
  companyId: string;
  /** The requesting employee: must be an Organizer or Approver at the company. */
  userId: string;
  venueId: string;
  eventDate: string; // YYYY-MM-DD
  partySize: number;
  budgetPerHead: number;
  notes?: string;
  /** Department the spend is charged to; must belong to the company. */
  departmentId?: string | null;
  /** Cost centre (required), project code and billing GSTIN for finance. */
  expense: ExpenseInput;
  /** Checkout-session lock the form took for this venue/date (reserveCheckoutSlot), if any. */
  checkoutToken?: string | null;
}

/** Roles allowed to file booking requests. Finance viewers are read-only. */
const CAN_REQUEST = new Set(["ORGANIZER", "APPROVER"]);

export interface PlaceBookingResult {
  status: "success" | "error";
  message: string;
  fieldErrors?: Partial<Record<BookingField, string>>;
  invoice?: TaxInvoicePayload;
  /** Set when the booking waits for sign-off; approverName lists approvers in order. */
  approval?: { reason: string; approverName: string; tiers: number };
  holdHours?: number;
  bookingId?: string;
  venueName?: string;
}

/**
 * The one booking path for every entry point (client portal form, WhatsApp,
 * Slack): validates, re-prices with the tenant's rate card, checks the date
 * hold and corporate policy, routes for approval when needed, then creates the
 * request with a hold. Callers handle cache revalidation.
 */
export async function placeBookingRequest(input: PlaceBookingInput): Promise<PlaceBookingResult> {
  const { companyId, userId, venueId, eventDate, partySize, notes } = input;
  const budgetPerHead = input.budgetPerHead;

  const [companies, venues, users] = await Promise.all([listCompanies(), listVenues(), listPortalUsers({ companyId })]);
  const company = companies.find((c) => c.id === companyId);
  const venue = venues.find((v) => v.id === venueId);
  const requester = users.find((u) => u.id === userId);

  // Who may book: checked before anything else, for every entry point.
  if (company && !requester) return { status: "error", message: `Only a signed-in employee of ${company.legal_name} can request bookings.` };
  if (requester && !CAN_REQUEST.has(requester.role ?? "")) {
    return { status: "error", message: `${requester.name} has the Finance viewer role, which can't request bookings. Ask an Organizer.` };
  }

  const fieldErrors: PlaceBookingResult["fieldErrors"] = {};
  if (!venue) fieldErrors.venue_id = "Choose a venue";
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate <= today) fieldErrors.event_date = "Pick a future date";
  if (!Number.isInteger(partySize) || partySize < 1) fieldErrors.party_size = "Enter a whole number of guests";
  else if (venue && partySize > venue.capacity_max) fieldErrors.party_size = `${venue.name} seats up to ${venue.capacity_max}`;
  if (!Number.isFinite(budgetPerHead) || budgetPerHead <= 0) fieldErrors.budget_per_head_inr = "Enter a budget per head";

  if (!company) return { status: "error", message: "Unknown company account." };
  const departmentId = input.departmentId || null;
  if (departmentId && !(await listDepartments({ companyIds: [company.id] })).some((d) => d.id === departmentId)) {
    return { status: "error", message: "Unknown department." };
  }
  const expense = validateExpense(input.expense, company.gstin);
  if (!expense.ok) Object.assign(fieldErrors, expense.errors);
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors, message: "Please fix the highlighted fields." };

  /** The critical section: re-price, check the date, route for approval, create with a hold. */
  const priceHoldAndCreate = async (): Promise<PlaceBookingResult> => {
    try {
      // The server re-prices with the tenant's rate card; the form's preview is advisory.
      const [pricing, availability] = await Promise.all([
        getNegotiatedRate({
          tenant_id: company.id,
          venue_id: venue!.id,
          event_date: eventDate,
          party_size: partySize,
          per_head_amount: budgetPerHead,
        }),
        checkHoldAvailability({ venue_id: venue!.id, from: eventDate, to: eventDate }),
      ]);
      if (!pricing.meetsMinimumSpend) {
        const agreed = pricing.rateCardId && pricing.minimumSpend !== Number(venue!.min_spend_inr) ? " agreed with your company" : "";
        fieldErrors.budget_per_head_inr = `${formatINR(pricing.taxableTotal)} is below ${venue!.name}'s minimum spend of ${formatINR(pricing.minimumSpend)}${agreed}`;
      }
      if (!availability.available) fieldErrors.event_date = `${venue!.name} isn't available on this date`;
      if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors, message: "Please fix the highlighted fields." };

      // Policy is checked against what the company will actually pay.
      const policy = await checkBookingPolicy({
        tenant_id: company.id,
        total_amount: pricing.taxableTotal,
        headcount: partySize,
        per_head_amount: pricing.negotiatedPerHead,
      });

      // Tier 1 (manager) signs off; above the high-value threshold tier 2 (senior) does too, after tier 1.
      // Nobody approves their own request: the requester is skipped and the next tier steps up.
      const approvals: NewApprovalRequest[] = [];
      let approverNames: string[] = [];
      if (policy.requiresApproval) {
        const chain = (await listApprovalChain(company.id)).filter((c) => c.approver_user_id !== userId);
        const assigned = chain.slice(0, policy.tiers);
        if (assigned.length < policy.tiers) {
          return {
            status: "error",
            message: `This booking needs ${policy.tiers === 2 ? "two levels of" : ""} sign-off (${policy.reason}), but ${company.legal_name} doesn't have enough approvers set up besides you.`,
          };
        }
        for (const c of assigned) approvals.push({ requested_by: userId, approver_id: c.approver_user_id, reason: policy.reason });
        approverNames = assigned.map((c) => users.find((u) => u.id === c.approver_user_id)?.name ?? "an approver");
      }

      const { hours, ...hold } = planHold(approvals.length > 0);
      const booking = await createBookingRequest(
        {
          company_id: company.id,
          venue_id: venue!.id,
          party_size: partySize,
          budget_per_head_inr: pricing.negotiatedPerHead,
          event_date: eventDate,
          notes,
          department_id: departmentId,
          // Snapshot list pricing so rate-card savings stay reportable.
          list_budget_per_head_inr: pricing.source === "list" ? null : pricing.listPerHead,
          rate_card_id: pricing.rateCardId,
          ...(expense.ok ? expense.value : { cost_center: "" }),
        },
        { approvals, hold }
      );
      if (approvals.length) {
        return {
          status: "success",
          message: approvals.length > 1 ? "Booking submitted — requires manager and senior sign-off." : "Booking submitted — requires manager sign-off.",
          invoice: booking.invoice,
          approval: { reason: approvals[0].reason, approverName: approverNames.join(", then "), tiers: approvals.length },
          holdHours: hours,
          bookingId: booking.id,
          venueName: venue!.name,
        };
      }
      return {
        status: "success",
        message: `Request sent to ${venue!.name}. The date is held for ${hours} hours while they respond.`,
        invoice: booking.invoice,
        holdHours: hours,
        bookingId: booking.id,
        venueName: venue!.name,
      };
    } catch (err) {
      if (err instanceof HoldConflictError) {
        return { status: "error", fieldErrors: { event_date: err.message }, message: "Please fix the highlighted fields." };
      }
      return { status: "error", message: err instanceof Error ? err.message : "Could not create the booking." };
    }
  };

  // Serialise checkouts per venue/date across server instances (lib/locks). The
  // inventory_holds trigger still rejects a double hold if the lock store is down.
  const slot = { venueId: venue!.id, date: eventDate };
  let locked: { ok: true; value: PlaceBookingResult } | { ok: false; retryAfterMs: number };
  try {
    locked = await getSlotLocks().locks.withSlot(slot, lockOwner(company.id, userId), priceHoldAndCreate, {
      token: input.checkoutToken,
      succeeded: (r) => r.status === "success",
    });
  } catch (err) {
    console.error("booking: slot lock unavailable, continuing without it", err);
    return priceHoldAndCreate();
  }
  if (!locked.ok) {
    const minutes = Math.max(1, Math.ceil(locked.retryAfterMs / 60_000));
    return {
      status: "error",
      fieldErrors: { event_date: `Someone else is booking ${venue!.name} on this date right now. Try again in ${minutes} min or pick another date.` },
      message: "Please fix the highlighted fields.",
    };
  }
  return locked.value;
}

/** Lock owner: the requesting employee, or the company for anonymous channel traffic. */
export function lockOwner(companyId: string, userId: string): string {
  return (userId || `company-${companyId}`).replace(/[^A-Za-z0-9:_-]/g, "");
}
