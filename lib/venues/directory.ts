import "server-only";

import { listVenues } from "@/lib/data";
import { fetchPartnersWithin, httpPartnerNetwork, mockPartnerNetwork, type DirectoryVenue, type PartnerStatus } from "@/lib/venues/partner-network";

export type { DirectoryVenue, PartnerStatus, VenueTier } from "@/lib/venues/partner-network";

const PARTNER_TIMEOUT_MS = 2500;

function partnerNetwork() {
  const url = (process.env.PARTNER_DIRECTORY_URL ?? "").trim();
  return url ? httpPartnerNetwork(url, (process.env.PARTNER_DIRECTORY_NAME ?? "").trim() || "Partner network") : mockPartnerNetwork;
}

/** Two-tier directory: Lufer.ai's own properties plus federated partner listings. */
export async function listDirectory(): Promise<{ venues: DirectoryVenue[]; partners: PartnerStatus }> {
  const [internal, partner] = await Promise.all([listVenues(), fetchPartnersWithin(partnerNetwork(), PARTNER_TIMEOUT_MS)]);
  const own: DirectoryVenue[] = internal.map((v) => ({
    id: v.id,
    tier: "internal",
    name: v.name,
    neighborhood: v.neighborhood,
    city: v.city,
    address: v.address,
    capacity_max: v.capacity_max,
    min_spend_inr: Number(v.min_spend_inr),
    pdr_available: v.pdr_available,
    gstin: v.gstin,
    commission_rate: Number(v.commission_rate),
    supplier: null,
    bookable: true,
  }));
  return { venues: [...own, ...partner.venues], partners: partner.status };
}
