/**
 * Cards for the venues Lufer's concierge quotes (partner listings kept in
 * Lufer), and the filters on /venues. Pure, so tests and the client can run it.
 */
import { VENUE_CATEGORIES, type VenueCategory } from "./category.ts";
import { distanceKm, venuePolicyStatus, type OfficeLocation, type VenueCardRules, type VenuePolicyStatus } from "./discovery.ts";
import type { DirectoryVenue } from "./partner-network.ts";

export interface ConciergeCard {
  /** partner_venues id (what "Request a quote" names). */
  id: string;
  name: string;
  neighborhood: string;
  city: string;
  address: string;
  capacity: number;
  privateRoom: boolean;
  category: VenueCategory | null;
  /** Cheapest per-head rate active today; null = price on request. */
  perHead: number | null;
  minSpend: number;
  photos: string[];
  latitude: number | null;
  longitude: number | null;
  /** The company's policy fit; only when the venue has a price and the company has rules. */
  policy: VenuePolicyStatus | null;
}

/** Listings kept in Lufer (partner_venues), quoted through the concierge. */
export const conciergeListings = (venues: readonly DirectoryVenue[]) => venues.filter((v) => v.tier === "partner" && v.id.startsWith("extranet:"));

export function toConciergeCards(venues: readonly DirectoryVenue[], rules: VenueCardRules | null = null, office: OfficeLocation | null = null): ConciergeCard[] {
  return conciergeListings(venues).map((v) => {
    const perHead = v.from_per_head_inr ?? null;
    const located = v.latitude != null && v.longitude != null ? { latitude: v.latitude, longitude: v.longitude } : null;
    const policy = rules && perHead !== null ? venuePolicyStatus(rules, { from_per_head_inr: perHead, min_spend_inr: v.min_spend_inr }, office && located ? distanceKm(office, located) : null) : null;
    return {
      id: v.id.replace(/^extranet:/, ""),
      name: v.name,
      neighborhood: v.neighborhood,
      city: v.city,
      address: v.address,
      capacity: v.capacity_max,
      privateRoom: v.pdr_available,
      category: v.category ?? null,
      perHead,
      minSpend: v.min_spend_inr,
      photos: v.photo_urls?.length ? v.photo_urls : v.photo_url ? [v.photo_url] : [],
      latitude: located?.latitude ?? null,
      longitude: located?.longitude ?? null,
      policy,
    };
  });
}

export const CAPACITY_BANDS = { "": "Any size", lt50: "Under 50", "50-300": "50–300", "300+": "300+" } as const;
export const SPACE_TYPES = { "": "Any space", private: "Private room", banquet: "Banquet / offsite", fine: "Fine dining" } as const;
export const SORTS = { recommended: "Recommended", capacity: "Most guests", price: "Lowest price" } as const;

export interface ConciergeFilters {
  city: string;
  guests: keyof typeof CAPACITY_BANDS;
  space: keyof typeof SPACE_TYPES;
  inPolicy: boolean;
  sort: keyof typeof SORTS;
}

const pick = <T extends Record<string, string>>(table: T, v: unknown, fallback: keyof T): keyof T => (typeof v === "string" && Object.hasOwn(table, v) ? v : fallback);

/** Filters from the URL (?city=&guests=&space=&policy=1&sort=); anything unknown falls back to the default. */
export function parseConciergeFilters(params: Record<string, string | string[] | undefined>, cities: readonly string[]): ConciergeFilters {
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const city = one("city");
  return {
    city: typeof city === "string" && cities.includes(city) ? city : cities.length === 1 ? cities[0] : "",
    guests: pick(CAPACITY_BANDS, one("guests"), ""),
    space: pick(SPACE_TYPES, one("space"), ""),
    inPolicy: one("policy") === "1",
    sort: pick(SORTS, one("sort"), "recommended"),
  };
}

/** The query string for `filters`, leaving defaults out so plain /venues stays plain. */
export function conciergeFilterQuery(f: ConciergeFilters, cities: readonly string[]): string {
  const q = new URLSearchParams();
  if (f.city && !(cities.length === 1 && f.city === cities[0])) q.set("city", f.city);
  if (f.guests) q.set("guests", f.guests);
  if (f.space) q.set("space", f.space);
  if (f.inPolicy) q.set("policy", "1");
  if (f.sort !== "recommended") q.set("sort", f.sort);
  const s = q.toString();
  return s ? `?${s}` : "";
}

const inBand = (capacity: number, band: ConciergeFilters["guests"]) =>
  band === "lt50" ? capacity < 50 : band === "50-300" ? capacity >= 50 && capacity <= 300 : band === "300+" ? capacity > 300 : true;

const isSpace = (c: ConciergeCard, space: ConciergeFilters["space"]) =>
  space === "private" ? c.privateRoom : space === "banquet" ? c.category === "hotel" : space === "fine" ? c.category === "fine_dining" : true;

const POLICY_RANK = { in_policy: 0, requires_manager: 1, requires_cfo: 2 } as const;
/** Recommended order within a policy band: hotels (most event space) first, bars last. */
const CATEGORY_RANK: Record<VenueCategory, number> = { hotel: 0, fine_dining: 1, casual_dining: 2, bar: 3 };

/** Filter and sort. Recommended: in-policy first, then by type, then name. Stable. */
export function applyConciergeFilters(cards: readonly ConciergeCard[], f: ConciergeFilters): ConciergeCard[] {
  const out = cards.filter((c) => (!f.city || c.city === f.city) && inBand(c.capacity, f.guests) && isSpace(c, f.space) && (!f.inPolicy || c.policy?.status === "in_policy"));
  const rank = (c: ConciergeCard) => (c.policy ? POLICY_RANK[c.policy.status] : 1);
  const by: Record<ConciergeFilters["sort"], (a: ConciergeCard, b: ConciergeCard) => number> = {
    recommended: (a, b) => rank(a) - rank(b) || (a.category ? CATEGORY_RANK[a.category] : 4) - (b.category ? CATEGORY_RANK[b.category] : 4) || a.name.localeCompare(b.name),
    capacity: (a, b) => b.capacity - a.capacity,
    price: (a, b) => (a.perHead ?? Infinity) - (b.perHead ?? Infinity),
  };
  return out.map((c, i) => [c, i] as const).sort(([a, i], [b, j]) => by[f.sort](a, b) || i - j).map(([c]) => c);
}

export const categoryLabel = (c: VenueCategory | null) => (c ? VENUE_CATEGORIES[c] : null);
