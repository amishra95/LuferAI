"use server";

import { revalidatePath } from "next/cache";

import { requirePortal } from "@/lib/auth/session";
import { releaseHold, updateBookingStatus } from "@/lib/data";
import { dispatchBookingConfirmed } from "@/lib/finance/export-dispatcher";
import { settleDeposit } from "@/lib/payments/service";
import { respondToRfp } from "@/lib/rfp/service";
import type { BookingStatus } from "@/lib/supabase/database.types";

const INTENT_TO_STATUS: Record<string, BookingStatus> = {
  approve: "CONFIRMED",
  decline: "CANCELLED",
  complete: "COMPLETED",
};

/** The acting venue: a property manager's own; admins may pass one. */
async function actingVenueId(formData: FormData): Promise<string> {
  const member = await requirePortal("/property");
  // Never trust the submitted venue for property managers.
  return member.role === "ADMIN" ? String(formData.get("venue_id") ?? "") : member.venueId ?? "";
}

/** Approve / decline / complete a booking on behalf of the acting venue. */
export async function respondToBooking(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const bookingId = String(formData.get("booking_id") ?? "");
  const next = INTENT_TO_STATUS[String(formData.get("intent") ?? "")];
  if (!bookingId || !venueId || !next) throw new Error("Invalid booking action");

  // Scoped to the venue so one property can never update another's booking. The
  // bookings_sync_inventory_holds trigger converts/releases the date hold.
  await updateBookingStatus(bookingId, next, { venueId });
  // Finance sync: export the receipt on confirmation. Failures are logged, never block the venue.
  if (next === "CONFIRMED") await dispatchBookingConfirmed(bookingId);

  // Confirming captures the client's deposit; declining releases it.
  if (next === "CONFIRMED") await settleDeposit(bookingId, "capture");
  if (next === "CANCELLED") await settleDeposit(bookingId, "void");

  revalidatePath("/property");
  revalidatePath("/client");
  revalidatePath("/admin");
}

/** Releases one of the acting venue's live holds early, freeing the date. */
export async function releaseVenueHold(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const holdId = String(formData.get("hold_id") ?? "");
  if (!holdId || !venueId) throw new Error("Invalid hold action");

  await releaseHold(holdId, { venueId });

  revalidatePath("/property");
  revalidatePath("/client");
}

/**
 * Converts a hold by confirming its booking: the bookings_sync_inventory_holds
 * trigger (mirrored in mock mode) marks the hold CONVERTED.
 */
export async function convertVenueHold(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!bookingId || !venueId) throw new Error("Invalid hold action");

  await updateBookingStatus(bookingId, "CONFIRMED", { venueId });
  await dispatchBookingConfirmed(bookingId);
  await settleDeposit(bookingId, "capture");

  revalidatePath("/property");
  revalidatePath("/client");
  revalidatePath("/admin");
}

/** Counter-offer (per-head price, optional package) or decline on an RFP sent to this venue. */
export async function respondToRfpAction(formData: FormData) {
  const venueId = await actingVenueId(formData);
  const responseId = String(formData.get("response_id") ?? "");
  const decline = formData.get("intent") === "decline";
  if (!venueId || !responseId) throw new Error("Invalid RFP response");

  await respondToRfp({
    responseId,
    venueId,
    decline,
    perHeadInr: Number(formData.get("per_head_inr")) || undefined,
    menuPackageId: String(formData.get("menu_package_id") ?? "") || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  revalidatePath("/property");
  revalidatePath("/client");
}
