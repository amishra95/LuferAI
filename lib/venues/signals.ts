/**
 * Social and behaviour signals on venue cards: "Booked by 3 coworkers",
 * "Company favorite", "You've booked here", "Usually confirms within 2 h".
 * Pure: the client page computes them from its own bookings, and
 * tests/venue-signals.test.mjs exercises them directly.
 *
 * Only bookings that happened count (confirmed, completed or settled), within
 * the last year. Coworker signals come from the viewer's own company's
 * bookings; response times are a cross-company median per venue, published
 * only once there are enough of them that no single booking shows through.
 * Ratings are the cross-company review average (lib/venues/reviews.ts), on
 * the same terms.
 */

import { isTopRated, ratingLabel, type VenueRating } from "./reviews.ts";

/** Bookings that went ahead: requested, accepted by the venue, and not cancelled. */
export const BOOKED_STATUSES: ReadonlySet<string> = new Set(["CONFIRMED", "COMPLETED", "SETTLED"]);

/** How far back signals look. */
export const SIGNAL_WINDOW_DAYS = 365;
/** A company favorite: one of its top venues, booked at least this often in the window. */
export const FAVORITE_MIN_BOOKINGS = 3;
export const FAVORITE_TOP_N = 3;
/** Response times are shown once a venue has this many, and only when the median is quick. */
export const RESPONSE_MIN_SAMPLES = 3;
export const FAST_RESPONSE_HOURS = 6;

export interface VenueSignals {
  /** Coworkers (not the viewer) who booked here in the window. */
  coworkers: number;
  /** The viewer booked here themselves. */
  youBooked: boolean;
  /** Among the company's most-booked venues. */
  companyFavorite: boolean;
  /** Median hours from a request reaching the venue to its acceptance, when quick and well sampled. */
  confirmsWithinHours: number | null;
  /** Review average across companies, once well sampled; null without one. */
  rating: VenueRating | null;
}

/** Signals that come from every company, not just the viewer's. */
export interface CrossCompanySignals {
  /** Median hours to confirm (venueResponseMedians). */
  responseHours?: ReadonlyMap<string, number>;
  /** Review averages (venueRatings). */
  ratings?: ReadonlyMap<string, VenueRating>;
}

export interface SignalBooking {
  venue_id: string;
  status: string;
  /** Who requested it (bookings.requested_by); null for bookings filed before it was recorded. */
  requested_by: string | null;
  event_date: string;
  created_at: string;
}

const DAY_MS = 86_400_000;
const inWindow = (b: SignalBooking, now: number) => BOOKED_STATUSES.has(b.status) && now - new Date(b.created_at).getTime() <= SIGNAL_WINDOW_DAYS * DAY_MS;

/**
 * Per venue, from the viewer's company's bookings, plus the cross-company
 * response times and ratings; venues without one get null for it.
 */
export function venueSignals(
  bookings: readonly SignalBooking[],
  viewerId: string | null,
  { responseHours = new Map(), ratings = new Map() }: CrossCompanySignals = {},
  now = Date.now()
): Map<string, VenueSignals> {
  const recent = bookings.filter((b) => inWindow(b, now));
  const byVenue = new Map<string, SignalBooking[]>();
  for (const b of recent) byVenue.set(b.venue_id, [...(byVenue.get(b.venue_id) ?? []), b]);

  // Most booked first; ties by the most recent booking, so the list is stable.
  const favorites = new Set(
    [...byVenue.entries()]
      .filter(([, list]) => list.length >= FAVORITE_MIN_BOOKINGS)
      .sort(([, a], [, b]) => b.length - a.length || Math.max(...b.map((x) => Date.parse(x.created_at))) - Math.max(...a.map((x) => Date.parse(x.created_at))))
      .slice(0, FAVORITE_TOP_N)
      .map(([venueId]) => venueId)
  );

  const out = new Map<string, VenueSignals>();
  for (const venueId of new Set([...byVenue.keys(), ...responseHours.keys(), ...ratings.keys()])) {
    const list = byVenue.get(venueId) ?? [];
    const people = new Set(list.map((b) => b.requested_by).filter((id): id is string => Boolean(id)));
    const youBooked = Boolean(viewerId && people.has(viewerId));
    if (viewerId) people.delete(viewerId);
    const hours = responseHours.get(venueId);
    out.set(venueId, {
      coworkers: people.size,
      youBooked,
      companyFavorite: favorites.has(venueId),
      confirmsWithinHours: hours != null && hours <= FAST_RESPONSE_HOURS ? hours : null,
      rating: ratings.get(venueId) ?? null,
    });
  }
  return out;
}

export interface ResponseSample {
  venue_id: string;
  /** When the request reached the venue: when it was made, or when its last approval was given. */
  reached_venue_at: string;
  venue_accepted_at: string;
}

/**
 * Median hours to accept, per venue, from samples in the window; only venues
 * with at least RESPONSE_MIN_SAMPLES. Rounded up to the hour (a 40-minute
 * median reads "within 1 h").
 */
export function venueResponseMedians(samples: readonly ResponseSample[], now = Date.now()): Map<string, number> {
  const byVenue = new Map<string, number[]>();
  for (const s of samples) {
    const from = Date.parse(s.reached_venue_at);
    const to = Date.parse(s.venue_accepted_at);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || now - to > SIGNAL_WINDOW_DAYS * DAY_MS) continue;
    byVenue.set(s.venue_id, [...(byVenue.get(s.venue_id) ?? []), (to - from) / 3_600_000]);
  }
  const out = new Map<string, number>();
  for (const [venueId, hours] of byVenue) {
    if (hours.length < RESPONSE_MIN_SAMPLES) continue;
    const sorted = [...hours].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    out.set(venueId, Math.max(1, Math.ceil(median)));
  }
  return out;
}

export type SignalKey = "favorite" | "rated" | "coworkers" | "you" | "fast";

/** The badge texts for a venue, most persuasive first. */
export function signalLabels(s: VenueSignals | undefined): { key: SignalKey; label: string }[] {
  if (!s) return [];
  const out: { key: SignalKey; label: string }[] = [];
  if (s.companyFavorite) out.push({ key: "favorite", label: "Company favorite" });
  if (s.rating) out.push({ key: "rated", label: `${isTopRated(s.rating) ? "Top rated · " : ""}${ratingLabel(s.rating)}` });
  if (s.coworkers > 0) out.push({ key: "coworkers", label: s.coworkers === 1 ? "Booked by a coworker" : `Booked by ${s.coworkers} coworkers` });
  if (s.youBooked) out.push({ key: "you", label: "You've booked here" });
  if (s.confirmsWithinHours != null) out.push({ key: "fast", label: `Usually confirms within ${s.confirmsWithinHours} h` });
  return out;
}
