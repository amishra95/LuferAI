"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";

import {
  createBookingRequest,
  decideApproval,
  HoldConflictError,
  listApprovalChain,
  listApprovals,
  listCompanies,
  listPortalUsers,
  listVenues,
  dataSource,
  type NewApprovalRequest,
} from "@/lib/data";
import type { TaxInvoicePayload } from "@/lib/gst-engine";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import { planHold } from "@/lib/inventory/plan-hold";
import { checkBookingPolicy } from "@/lib/policies/checkBookingPolicy";
import { getNegotiatedRate, type NegotiatedPricing } from "@/lib/rates/getNegotiatedRate";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatINR } from "@/lib/utils";

export interface BookingRequestState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<"venue_id" | "event_date" | "party_size" | "budget_per_head_inr", string>>;
  invoice?: TaxInvoicePayload;
  /** Set when the booking breached policy and is waiting on a manager. */
  approval?: { reason: string; approverName: string };
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
  const companyId = member.role === "ADMIN" ? input.companyId : member.companyId ?? "";
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
  // Never trust the submitted company or requester: they come from the session
  // (only admins may act for another company, and admins can't request sign-off).
  const companyId = member.role === "ADMIN" ? String(formData.get("company_id") ?? "") : member.companyId ?? "";
  const userId = member.role === "CLIENT" ? member.userId : "";
  const departmentId = String(formData.get("department_id") ?? "") || null;
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

  if (!company) return { status: "error", message: "Unknown company account." };
  if (departmentId && dataSource() === "supabase") {
    const { data: dept } = await createAdminClient()
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("company_id", company.id)
      .maybeSingle();
    if (!dept) return { status: "error", message: "Unknown department." };
  }
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
        return { status: "error", message: `This booking needs sign-off (${policy.reason}). Only a signed-in employee of ${company.legal_name} can request it.` };
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
        department_id: departmentId,
        // Snapshot list pricing so rate-card savings stay reportable.
        list_budget_per_head_inr: pricing.source === "list" ? null : pricing.listPerHead,
        rate_card_id: pricing.rateCardId,
      },
      { approval, hold }
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
        holdHours: hours,
      };
    }
    return {
      status: "success",
      message: `Request sent to ${venue!.name}. The date is held for ${hours} hours while they respond.`,
      invoice: booking.invoice,
      holdHours: hours,
    };
  } catch (err) {
    if (err instanceof HoldConflictError) {
      return { status: "error", fieldErrors: { event_date: err.message }, message: "Please fix the highlighted fields." };
    }
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
