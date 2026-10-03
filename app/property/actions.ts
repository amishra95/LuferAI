"use server";

import { revalidatePath } from "next/cache";

import { updateBookingStatus } from "@/lib/data";
import type { BookingStatus } from "@/lib/supabase/database.types";

const INTENT_TO_STATUS: Record<string, BookingStatus> = {
  approve: "CONFIRMED",
  decline: "CANCELLED",
  complete: "COMPLETED",
};

/** Approve / decline / complete a booking on behalf of the acting venue. */
export async function respondToBooking(formData: FormData) {
  const bookingId = String(formData.get("booking_id") ?? "");
  const venueId = String(formData.get("venue_id") ?? "");
  const next = INTENT_TO_STATUS[String(formData.get("intent") ?? "")];
  if (!bookingId || !venueId || !next) throw new Error("Invalid booking action");

  // Scoped to the venue so one property can never update another's booking.
  await updateBookingStatus(bookingId, next, { venueId });

  revalidatePath("/property");
  revalidatePath("/client");
  revalidatePath("/admin");
}
