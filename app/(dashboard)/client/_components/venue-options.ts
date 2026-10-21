import type { CatalogVenue } from "@/lib/catalog";
import { dietaryLabel } from "@/lib/quotes";

import type { VenueOption } from "./event-request-form";

const fromPrice = (v: CatalogVenue) => (v.packages.length ? Math.min(...v.packages.map((p) => p.per_head_inr)) : null);

/** One venue card's data, shared by the explorer, the wizard's VenuePicker and the manual booking modal. */
export const toVenueOption = (v: CatalogVenue): VenueOption => ({
  id: v.id,
  name: v.name,
  neighborhood: v.neighborhood,
  city: v.city,
  gstin: v.gstin,
  capacity_max: v.capacity_max,
  min_spend_inr: v.rate_card?.minSpendOverride ?? v.min_spend_inr,
  pdr_available: v.pdr_available,
  from_per_head_inr: fromPrice(v),
  rate_card_label: v.rate_card?.label ?? null,
  dietary: [...new Set(v.packages.flatMap((p) => p.dietary_tags))].map(dietaryLabel),
});
