/** What kind of place a partner listing is (partner_venues.category). */
export const VENUE_CATEGORIES = {
  hotel: "5-star hotel",
  fine_dining: "Fine dining",
  casual_dining: "Casual dining",
  bar: "Bar & brewery",
} as const;

export type VenueCategory = keyof typeof VENUE_CATEGORIES;

export const isVenueCategory = (v: unknown): v is VenueCategory => typeof v === "string" && Object.hasOwn(VENUE_CATEGORIES, v);
