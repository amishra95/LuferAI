import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { matchVenues, venueSearchSchema, type VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { computePlatformMetrics, listBookings, listVenues } from "@/lib/data";

export async function searchVenueCatalogue(filters: VenueSearchFilters) {
  const venues = await listVenues();
  const options = matchVenues(
    venues.map((v) => ({ ...v, min_spend_inr: Number(v.min_spend_inr) })),
    filters,
    null
  );
  return {
    total: options.length,
    venues: options.slice(0, 5).map((o) => ({
      name: o.venue.name,
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
      "Search the venue catalogue in Bengaluru by location, guest count, per-head budget (INR, pre-GST) and features. " +
      "Returns up to 5 matching venues with estimated cost.",
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
