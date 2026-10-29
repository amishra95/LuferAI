import "server-only";

import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VenueReview } from "@/lib/supabase/database.types";
import { parseReviewInput, REVIEWABLE_STATUSES, venueRatings, type VenueRating } from "@/lib/venues/reviews";

/** A reviewer-facing reason a review was refused. */
export class ReviewError extends Error {}

/** Enough reviews for any venue's average; the oldest drop off first. */
const MAX_REVIEWS = 10_000;

/** Postgres "relation does not exist": before migration 20261107000000. */
const missingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

/**
 * Cross-company averages for venue cards, only for venues with enough reviews
 * (lib/venues/reviews.ts). Never throws: without reviews there's no badge.
 */
export async function venueRatingMap(): Promise<Map<string, VenueRating>> {
  if (dataSource() !== "supabase") return new Map();
  try {
    const { data, error } = await createAdminClient().from("venue_reviews").select("venue_id, rating").order("created_at", { ascending: false }).limit(MAX_REVIEWS);
    if (error) throw error;
    return venueRatings(data);
  } catch (err) {
    console.error("venues: ratings unavailable", err);
    return new Map();
  }
}

/** The company's own reviews, by booking id: what the bookings table shows and pre-fills. */
export async function reviewsForBookings(bookingIds: string[]): Promise<Map<string, VenueReview>> {
  if (dataSource() !== "supabase" || bookingIds.length === 0) return new Map();
  const { data, error } = await createAdminClient().from("venue_reviews").select("*").in("booking_id", bookingIds);
  if (missingTable(error)) return new Map();
  if (error) throw error;
  return new Map(data.map((r) => [r.booking_id, r]));
}

/** A venue's reviews, newest first, with the reviewing company's name (the venue sees who said it). */
export async function listVenueReviews(venueId: string, limit = 20): Promise<(VenueReview & { company_name: string })[]> {
  if (dataSource() !== "supabase") return [];
  const { data, error } = await createAdminClient()
    .from("venue_reviews")
    .select("*, company:companies(legal_name)")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (missingTable(error)) return [];
  if (error) throw error;
  type Row = VenueReview & { company: { legal_name: string } | null };
  return (data as unknown as Row[]).map(({ company, ...r }) => ({ ...r, company_name: company?.legal_name ?? "A client" }));
}

/**
 * Creates or replaces the review of one of the company's completed bookings.
 * The caller is the signed-in client; the booking must be their company's.
 */
export async function saveReview(input: { bookingId: string; companyId: string; authorId: string; rating: unknown; comment: unknown }): Promise<void> {
  if (dataSource() !== "supabase") throw new ReviewError("Reviews need the live database.");
  const parsed = parseReviewInput(input.rating, input.comment);
  if (!parsed.ok) throw new ReviewError(parsed.error);
  const db = createAdminClient();
  const { data: booking, error: readError } = await db.from("bookings").select("id, company_id, venue_id, status").eq("id", input.bookingId).maybeSingle();
  if (readError) throw readError;
  // The same message for someone else's booking as for none, so ids can't be probed.
  if (!booking || booking.company_id !== input.companyId) throw new ReviewError("Booking not found.");
  if (!REVIEWABLE_STATUSES.has(booking.status)) throw new ReviewError("You can review an event once it has happened.");
  const { error } = await db.from("venue_reviews").upsert(
    { booking_id: booking.id, venue_id: booking.venue_id, company_id: booking.company_id, author_id: input.authorId, rating: parsed.rating, comment: parsed.comment },
    { onConflict: "booking_id" }
  );
  if (missingTable(error)) throw new ReviewError("Reviews need database migration 20261107000000. Ask an admin to apply it.");
  if (error) throw error;
}
