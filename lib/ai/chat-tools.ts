import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { matchVenues, venueSearchSchema, type VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { computePlatformMetrics, listBookings } from "@/lib/data";
import { listDirectory } from "@/lib/venues/directory";

const MAX_RESULTS = 6;

/**
 * Searches the two-tier directory: Lufer.ai's own venues (bookable here) and
 * federated partner listings (booked through their supplier). Internal venues
 * rank first; partner results fill the rest. If the partner network is down,
 * internal results still come back with partnerNetwork.status = "unavailable".
 */
export async function searchVenueCatalogue(filters: VenueSearchFilters) {
  const { venues, partners } = await listDirectory();
  const options = matchVenues(venues, filters, null);
  const internal = options.filter((o) => o.venue.tier === "internal");
  const partner = options.filter((o) => o.venue.tier === "partner");
  // Keep at least one partner slot when partners match, so the federated tier stays visible.
  const take = [...internal.slice(0, partner.length ? MAX_RESULTS - 1 : MAX_RESULTS), ...partner].slice(0, MAX_RESULTS);
  return {
    total: options.length,
    internalTotal: internal.length,
    partnerTotal: partner.length,
    partnerNetwork: partners,
    venues: take.map((o) => ({
      name: o.venue.name,
      tier: o.venue.tier,
      supplier: o.venue.supplier,
      bookable: o.venue.bookable,
      neighborhood: o.venue.neighborhood,
      capacity: o.venue.capacity_max,
      minSpendInr: o.venue.min_spend_inr,
      privateDining: o.venue.pdr_available,
      estimatedTotalInr: o.estimatedTotal,
    })),
  };
}

/** Tools the workspace agent can call. Both read live app data (Supabase or the mock store). */
export const chatTools = {
  searchVenues: tool({
    description:
      "Search the venue directory in Bengaluru by location, guest count, per-head budget (INR, pre-GST) and features. " +
      "Covers Lufer.ai's own venues (tier internal, bookable here) and partner-network venues (tier partner, booked via their supplier). " +
      "Returns up to 6 matches with estimated cost.",
    inputSchema: venueSearchSchema,
    execute: searchVenueCatalogue,
  }),

  getPlatformMetrics: tool({
    description: "Get platform-wide booking totals: booking counts, gross booking value, commission and GST collected (INR).",
    inputSchema: z.object({}),
    execute: async () => computePlatformMetrics(await listBookings()),
  }),
};

export type ChatTools = typeof chatTools;
