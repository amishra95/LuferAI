"use server";

import { revalidatePath } from "next/cache";

import { createBookingRequest, listCompanies, listVenues } from "@/lib/data";
import type { TaxInvoicePayload } from "@/lib/gst-engine";

export interface BookingRequestState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<"venue_id" | "event_date" | "party_size" | "budget_per_head_inr", string>>;
  invoice?: TaxInvoicePayload;
}

export async function submitBookingRequest(
  _prev: BookingRequestState,
  formData: FormData
): Promise<BookingRequestState> {
  const companyId = String(formData.get("company_id") ?? "");
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
    const booking = await createBookingRequest({
      company_id: company.id,
      venue_id: venue!.id,
      party_size: partySize,
      budget_per_head_inr: budgetPerHead,
      event_date: eventDate,
      notes,
    });
    revalidatePath("/client");
    revalidatePath("/property");
    revalidatePath("/admin");
    return {
      status: "success",
      message: `Request sent to ${venue!.name}. You'll see it update here once the venue responds.`,
      invoice: booking.invoice,
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Could not create the booking." };
  }
}
