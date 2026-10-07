import "server-only";

import {
  createBookingRequest,
  HoldConflictError,
  listApprovalChain,
  listCompanies,
  listPortalUsers,
  listVenues,
  type NewApprovalRequest,
} from "@/lib/data";
import type { TaxInvoicePayload } from "@/lib/gst-engine";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { planHold } from "@/lib/inventory/plan-hold";
import { checkBookingPolicy } from "@/lib/policies/checkBookingPolicy";
import { getNegotiatedRate } from "@/lib/rates/getNegotiatedRate";
import { formatINR } from "@/lib/utils";

export type BookingField = "venue_id" | "event_date" | "party_size" | "budget_per_head_inr";

export interface PlaceBookingInput {
  companyId: string;
  /** The requesting employee; needed when policy routes the booking for sign-off. */
  userId: string;
  venueId: string;
  eventDate: string; // YYYY-MM-DD
  partySize: number;
  budgetPerHead: number;
  notes?: string;
}

export interface PlaceBookingResult {
  status: "success" | "error";
  message: string;
  fieldErrors?: Partial<Record<BookingField, string>>;
  invoice?: TaxInvoicePayload;
  approval?: { reason: string; approverName: string };
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

  const [companies, venues] = await Promise.all([listCompanies(), listVenues()]);
  const company = companies.find((c) => c.id === companyId);
  const venue = venues.find((v) => v.id === venueId);

  const fieldErrors: PlaceBookingResult["fieldErrors"] = {};
  if (!venue) fieldErrors.venue_id = "Choose a venue";
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate <= today) fieldErrors.event_date = "Pick a future date";
  if (!Number.isInteger(partySize) || partySize < 1) fieldErrors.party_size = "Enter a whole number of guests";
  else if (venue && partySize > venue.capacity_max) fieldErrors.party_size = `${venue.name} seats up to ${venue.capacity_max}`;
  if (!Number.isFinite(budgetPerHead) || budgetPerHead <= 0) fieldErrors.budget_per_head_inr = "Enter a budget per head";

  if (!company) return { status: "error", message: "Unknown company account." };
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors, message: "Please fix the highlighted fields." };

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

    const { hours, ...hold } = planHold(Boolean(approval));
    const booking = await createBookingRequest(
      {
        company_id: company.id,
        venue_id: venue!.id,
        party_size: partySize,
        budget_per_head_inr: pricing.negotiatedPerHead,
        event_date: eventDate,
        notes,
      },
      { approval, hold }
    );
    if (approval) {
      return {
        status: "success",
        message: "Booking submitted — requires manager sign-off.",
        invoice: booking.invoice,
        approval: { reason: approval.reason, approverName },
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
}
