/**
 * Venue reviews: one per completed booking, 1–5 stars and an optional
 * comment from the booking's company (migration 20261107000000).
 *
 * Venue cards show the average only once a venue has RATING_MIN_REVIEWS, so
 * a single review can't define a venue and no one company's review shows
 * through. Pure: tests import it directly (tests/venue-reviews.test.mjs).
 */

export const RATING_MIN_REVIEWS = 3;
/** "Top rated" from this average up, with enough reviews. */
export const TOP_RATED_AVERAGE = 4.5;
export const MAX_COMMENT_CHARS = 1000;
/** Statuses an event has happened in, and so can be reviewed. */
export const REVIEWABLE_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "SETTLED"]);

export interface VenueRating {
  /** Mean stars, to one decimal. */
  average: number;
  count: number;
}

/** Per venue, from every review; only venues with RATING_MIN_REVIEWS or more. */
export function venueRatings(reviews: readonly { venue_id: string; rating: number }[]): Map<string, VenueRating> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const r of reviews) {
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) continue;
    const s = sums.get(r.venue_id) ?? { total: 0, count: 0 };
    sums.set(r.venue_id, { total: s.total + r.rating, count: s.count + 1 });
  }
  const out = new Map<string, VenueRating>();
  for (const [venueId, { total, count }] of sums) {
    if (count >= RATING_MIN_REVIEWS) out.set(venueId, { average: Math.round((total / count) * 10) / 10, count });
  }
  return out;
}

export const isTopRated = (r: VenueRating | null | undefined) => Boolean(r && r.average >= TOP_RATED_AVERAGE);

/** "4.7 · 12 reviews" */
export const ratingLabel = (r: VenueRating) => `${r.average.toFixed(1)} · ${r.count} review${r.count === 1 ? "" : "s"}`;

export type ReviewInput = { ok: true; rating: number; comment: string | null } | { ok: false; error: string };

/** The client's review form, validated like the table. */
export function parseReviewInput(rating: unknown, comment: unknown): ReviewInput {
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, error: "Choose 1 to 5 stars." };
  const text = typeof comment === "string" ? comment.trim() : "";
  if (text.length > MAX_COMMENT_CHARS) return { ok: false, error: `Keep the comment under ${MAX_COMMENT_CHARS} characters.` };
  return { ok: true, rating: stars, comment: text || null };
}
