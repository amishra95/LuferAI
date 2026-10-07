import "server-only";

import { listVenues } from "@/lib/data";
import { listExtranetListings } from "@/lib/partner/service";
import { fetchPartnersWithin, httpPartnerNetwork, mockPartnerNetwork, type DirectoryVenue, type PartnerStatus } from "@/lib/venues/partner-network";

export type { DirectoryVenue, PartnerStatus, VenueTier } from "@/lib/venues/partner-network";

const PARTNER_TIMEOUT_MS = 2500;

function partnerNetwork() {
  const url = (process.env.PARTNER_DIRECTORY_URL ?? "").trim();
  return url ? httpPartnerNetwork(url, (process.env.PARTNER_DIRECTORY_NAME ?? "").trim() || "Partner network") : mockPartnerNetwork;
}

/** Listings partners maintain themselves in the /partner extranet. A failure degrades to none. */
async function extranetVenues(): Promise<DirectoryVenue[]> {
  try {
    return (await listExtranetListings()).map((l) => ({
      id: `extranet:${l.id}`,
      tier: "partner",
      name: l.name,
      neighborhood: l.area,
      city: l.city,
      address: l.address,
      capacity_max: l.capacity,
      min_spend_inr: l.minSpendInr,
      pdr_available: l.privateDining,
      gstin: null,
      commission_rate: null,
      supplier: l.partnerName,
      bookable: false,
    }));
  } catch (err) {
    console.error("directory: extranet listings unavailable", err);
    return [];
  }
}

/**
 * Two-tier directory: Lufer.ai's own properties, plus partner listings from the
 * federated supplier feed and from the /partner extranet.
 */
export async function listDirectory(): Promise<{ venues: DirectoryVenue[]; partners: PartnerStatus }> {
  const [internal, partner, extranet] = await Promise.all([
    listVenues(),
    fetchPartnersWithin(partnerNetwork(), PARTNER_TIMEOUT_MS),
    extranetVenues(),
  ]);
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
  return { venues: [...own, ...partner.venues, ...extranet], partners: partner.status };
}
