import "server-only";

import { getActiveRateCard, listVenues } from "@/lib/data";
import { applyRateCard, type NegotiatedPricing } from "./apply-rate-card";

export type { NegotiatedPricing } from "./apply-rate-card";

/**
 * Prices a prospective booking for a tenant at a venue, applying the rate card
 * in effect on the event date if there is one (otherwise list pricing).
 */
export async function getNegotiatedRate(input: {
  tenant_id: string;
  venue_id: string;
  /** YYYY-MM-DD; picks which rate card applies. */
  event_date: string;
  party_size: number;
  /** Requested per-head amount, INR pre-GST. */
  per_head_amount: number;
}): Promise<NegotiatedPricing> {
  const [card, venues] = await Promise.all([
    getActiveRateCard(input.tenant_id, input.venue_id, input.event_date),
    listVenues(),
  ]);
  const venue = venues.find((v) => v.id === input.venue_id);
  if (!venue) throw new Error("Unknown or inactive venue");

  return applyRateCard(card, {
    partySize: input.party_size,
    perHead: input.per_head_amount,
    venueMinSpend: Number(venue.min_spend_inr),
  });
}
