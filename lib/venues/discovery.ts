/**
 * Venue discovery helpers (policy fit, distance from the office), kept free of
 * server/DB imports so the explorer can run them client-side and
 * tests/venue-discovery.test.mjs can test them directly.
 */

import { perHeadTier, type BookingPolicyRules } from "../policies/evaluate-booking-policy.ts";

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** The company's office (companies.office_*), for distance badges and the map's office pin. */
export interface OfficeLocation extends LatLng {
  label: string;
}

/**
 * The company's office, or null if it isn't set. Defensive: numeric columns can
 * arrive as strings, and companies persisted by the local store before the
 * office columns existed lack them.
 */
export function officeOf(company: {
  office_latitude?: number | string | null;
  office_longitude?: number | string | null;
  office_label?: string | null;
}): OfficeLocation | null {
  if (company.office_latitude == null || company.office_longitude == null) return null;
  return { latitude: Number(company.office_latitude), longitude: Number(company.office_longitude), label: company.office_label?.trim() || "office" };
}

/** The company rules a venue card can be checked against before an event is specified. */
export type VenueCardRules = Pick<
  BookingPolicyRules,
  "max_budget_per_head" | "requires_approval_above" | "high_value_threshold" | "auto_approval_limit_per_head" | "manager_approval_limit_per_head" | "max_office_distance_km"
>;

export type VenuePolicyStatus =
  | { status: "in_policy" }
  /**
   * Booking it at its own minimums already needs sign-off: manager (tier 1) or
   * CFO (tier 2). range: the per-head tier band, when that's what decides it.
   */
  | { status: "requires_manager" | "requires_cfo"; reason: string; range?: string };

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

/**
 * Whether a venue fits the company's policy at its cheapest: the lowest package
 * per head against the per-head cap and approval tiers, the minimum spend
 * against the approval and high-value thresholds, and (given distanceKm) its
 * distance from the office. Price breaches route to sign-off, never block
 * (only alcohol does, per booking), so there's no "out of policy" venue.
 * No policy row = in policy.
 */
export function venuePolicyStatus(
  rules: VenueCardRules | null,
  venue: { from_per_head_inr: number | null; min_spend_inr: number },
  distanceKm: number | null = null
): VenuePolicyStatus {
  if (!rules) return { status: "in_policy" };
  const reasons: string[] = [];
  let cfo = false;
  let range: string | undefined;
  const perHead = venue.from_per_head_inr;
  if (rules.max_budget_per_head != null && perHead !== null && perHead > Number(rules.max_budget_per_head)) {
    reasons.push(`packages start at ${inr(perHead)}/head, over the ${inr(Number(rules.max_budget_per_head))} cap`);
  }
  if (perHead !== null) {
    const tier = perHeadTier(rules, perHead);
    const auto = rules.auto_approval_limit_per_head;
    const manager = rules.manager_approval_limit_per_head;
    if (tier.status === "requires_cfo") {
      cfo = true;
      range = `>${inr(Number(manager))}/head`;
      reasons.push(`packages start at ${inr(perHead)}/head, above the ${inr(Number(manager))} manager limit`);
    } else if (tier.status === "requires_manager") {
      range = manager != null ? `${inr(Number(auto))}–${inr(Number(manager))}/head` : `>${inr(Number(auto))}/head`;
      reasons.push(`packages start at ${inr(perHead)}/head, above the ${inr(Number(auto))} auto-approval limit`);
    }
  }
  if (rules.requires_approval_above != null && venue.min_spend_inr > Number(rules.requires_approval_above)) {
    reasons.push(`the ${inr(venue.min_spend_inr)} minimum spend is above the ${inr(Number(rules.requires_approval_above))} approval threshold`);
  }
  if (rules.high_value_threshold != null && venue.min_spend_inr > Number(rules.high_value_threshold)) {
    cfo = true;
    reasons.push(`the ${inr(venue.min_spend_inr)} minimum spend is above the ${inr(Number(rules.high_value_threshold))} high-value threshold`);
  }
  if (rules.max_office_distance_km != null && distanceKm !== null && distanceKm > Number(rules.max_office_distance_km)) {
    reasons.push(`it is ${distanceKm.toFixed(1)} km from the office, beyond the ${Number(rules.max_office_distance_km)} km limit`);
  }
  if (!reasons.length) return { status: "in_policy" };
  return { status: cfo ? "requires_cfo" : "requires_manager", reason: reasons.join("; "), ...(range ? { range } : {}) };
}

/** Map-marker colour per venue status: green, amber, red. */
export const POLICY_TONE = { in_policy: "ok", requires_manager: "warn", requires_cfo: "error" } as const satisfies Record<VenuePolicyStatus["status"], string>;

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Beyond this the venue is in another city; a distance badge would be noise. */
export const MAX_BADGE_KM = 50;

/**
 * "650 m from Indiranagar office", "1.8 km from HQ": straight-line, so it says
 * distance, not travel time. null when either point is missing or the venue is
 * out of town.
 */
export function officeDistanceLabel(
  office: OfficeLocation | null,
  venue: { latitude: number | null; longitude: number | null }
): string | null {
  if (!office || venue.latitude == null || venue.longitude == null) return null;
  return formatOfficeDistance(office, distanceKm(office, { latitude: venue.latitude, longitude: venue.longitude }));
}

/**
 * The badge for a distance already known, e.g. from PostGIS
 * (lib/actions/venue-search.ts); null when out of town.
 */
export function formatOfficeDistance(office: Pick<OfficeLocation, "label">, km: number): string | null {
  if (km > MAX_BADGE_KM) return null;
  const distance = km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toLocaleString("en-IN", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
  return `${distance} from ${office.label}`;
}
