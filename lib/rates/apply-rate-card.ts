/**
 * Pure rate-card pricing (tested in tests/rates-and-holds.test.mjs). Data access
 * lives in getNegotiatedRate.ts.
 */
import { roundInr } from "../gst-engine.ts";

export interface RateCardTerms {
  id: string;
  discount_percentage: number;
  custom_per_head_rate: number | null;
  minimum_spend_override: number | null;
  /** Inclusive YYYY-MM-DD. */
  effective_from: string;
  /** Inclusive YYYY-MM-DD; null = open-ended. */
  effective_to: string | null;
}

/** Whether a card covers an event date (both ends inclusive; ISO dates compare lexically). */
export function isRateCardActive(card: Pick<RateCardTerms, "effective_from" | "effective_to">, eventDate: string): boolean {
  return card.effective_from <= eventDate && (card.effective_to === null || eventDate <= card.effective_to);
}

export interface NegotiatedPricing {
  rateCardId: string | null;
  /** How the per-head price was set. */
  source: "list" | "discount" | "custom_rate";
  listPerHead: number;
  negotiatedPerHead: number;
  /** Venue minimum spend, or the card's override. */
  minimumSpend: number;
  /** Pre-GST: party size × negotiated per-head. */
  taxableTotal: number;
  /** listPerHead × party size − taxableTotal (negative if a custom rate is above list). */
  savings: number;
  meetsMinimumSpend: boolean;
}

/**
 * Prices a booking under a rate card. A custom per-head rate replaces the price
 * outright; otherwise discount_percentage comes off the requested per-head
 * amount. Per-head is rounded to paise before multiplying, as it's invoiced.
 */
export function applyRateCard(
  card: RateCardTerms | null,
  booking: { partySize: number; perHead: number; venueMinSpend: number }
): NegotiatedPricing {
  const listPerHead = roundInr(booking.perHead);
  const listTotal = roundInr(booking.partySize * listPerHead);

  let source: NegotiatedPricing["source"] = "list";
  let negotiatedPerHead = listPerHead;
  if (card?.custom_per_head_rate != null) {
    source = "custom_rate";
    negotiatedPerHead = roundInr(Number(card.custom_per_head_rate));
  } else if (card && Number(card.discount_percentage) > 0) {
    source = "discount";
    negotiatedPerHead = roundInr(listPerHead * (1 - Number(card.discount_percentage) / 100));
  }

  const minimumSpend = roundInr(card?.minimum_spend_override != null ? Number(card.minimum_spend_override) : booking.venueMinSpend);
  const taxableTotal = roundInr(booking.partySize * negotiatedPerHead);

  return {
    rateCardId: card?.id ?? null,
    source,
    listPerHead,
    negotiatedPerHead,
    minimumSpend,
    taxableTotal,
    savings: roundInr(listTotal - taxableTotal),
    meetsMinimumSpend: taxableTotal >= minimumSpend,
  };
}
