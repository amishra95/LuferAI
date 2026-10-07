/**
 * Pure venue-sourcing logic: the schema the model fills from a natural-language
 * request, and the deterministic filtering + policy labelling applied to the
 * venue catalogue. No server/DB imports, so tests/venue-sourcing.test.mjs can
 * exercise it without a model or database.
 */
import { z } from "zod";

import { evaluateBookingPolicy, type BookingPolicyRules } from "../policies/evaluate-booking-policy.ts";

export const venueSearchSchema = z.object({
  location: z
    .string()
    .describe('Neighbourhood or city named in the request, e.g. "Indiranagar". Empty string if none was given.'),
  minCapacity: z.number().int().min(1).describe("Number of guests the venue must hold."),
  maxBudgetPerHead: z
    .number()
    .min(0)
    .describe("Budget per guest in INR, pre-GST. 0 if the request gives no budget."),
  features: z
    .array(z.string())
    .describe('Requested amenities in short lowercase form, e.g. "private dining room", "projector", "live music".'),
});

export type VenueSearchFilters = z.infer<typeof venueSearchSchema>;

export interface CatalogueVenue {
  id: string;
  name: string;
  city: string;
  neighborhood: string;
  address: string;
  capacity_max: number;
  min_spend_inr: number;
  pdr_available: boolean;
}

export type PolicyLabel = "Policy Compliant" | "Requires Manager Approval";

export interface VenueOption<V extends CatalogueVenue = CatalogueVenue> {
  venue: V;
  label: PolicyLabel;
  /** Why approval is needed; absent when compliant. */
  policyReason?: string;
  /** What the booking would actually cost once the venue's minimum spend applies. */
  estimatedPerHead: number;
  estimatedTotal: number;
  /** Requested features the catalogue has no data for, so couldn't be checked. */
  unverifiedFeatures: string[];
}

// The only amenity the catalogue records is a private dining room.
const PRIVATE_DINING = /private (dining|room)|\bpdr\b|private space/i;

const roundUp = (n: number) => Math.ceil(n);

/**
 * Venues that fit the filters, each labelled against the tenant's policy.
 * Compliant options sort first, then the closest capacity fit.
 */
export function matchVenues<V extends CatalogueVenue>(
  venues: V[],
  filters: VenueSearchFilters,
  policy: BookingPolicyRules | null
): VenueOption<V>[] {
  const location = filters.location.trim().toLowerCase();
  const wantsPrivateDining = filters.features.some((f) => PRIVATE_DINING.test(f));
  const unverifiedFeatures = filters.features.filter((f) => !PRIVATE_DINING.test(f));
  const headcount = filters.minCapacity;
  const budget = filters.maxBudgetPerHead;

  return venues
    .filter((v) => !location || [v.city, v.neighborhood, v.address].some((s) => s.toLowerCase().includes(location)))
    .filter((v) => v.capacity_max >= headcount)
    .filter((v) => !wantsPrivateDining || v.pdr_available)
    // With a budget, drop venues whose minimum spend the group can't reach.
    .filter((v) => budget <= 0 || Number(v.min_spend_inr) <= headcount * budget)
    .map((v): VenueOption<V> => {
      const minSpend = Number(v.min_spend_inr);
      const estimatedTotal = Math.max(headcount * budget, minSpend);
      const estimatedPerHead = Math.max(budget, roundUp(minSpend / headcount));
      const result = evaluateBookingPolicy(policy, {
        total_amount: estimatedTotal,
        headcount,
        per_head_amount: estimatedPerHead,
      });
      return {
        venue: v,
        label: result.requiresApproval ? "Requires Manager Approval" : "Policy Compliant",
        policyReason: result.requiresApproval ? result.reason : undefined,
        estimatedPerHead,
        estimatedTotal,
        unverifiedFeatures,
      };
    })
    .sort(
      (a, b) =>
        Number(a.label !== "Policy Compliant") - Number(b.label !== "Policy Compliant") ||
        a.venue.capacity_max - b.venue.capacity_max
    );
}
