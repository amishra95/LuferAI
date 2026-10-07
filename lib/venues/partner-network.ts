/**
 * Federated partner directory: venues listed by external supplier networks,
 * shown alongside Lufer.ai's own (internal) properties. Pure: no server
 * imports, so tests can exercise the mapping and fallback logic.
 */
import { z } from "zod";

export type VenueTier = "internal" | "partner";

/** One row of the unified directory, whichever tier it comes from. */
export interface DirectoryVenue {
  id: string;
  tier: VenueTier;
  name: string;
  neighborhood: string;
  city: string;
  address: string;
  capacity_max: number;
  min_spend_inr: number;
  pdr_available: boolean;
  /** Internal venues are GST-onboarded; partner venues may not expose one. */
  gstin: string | null;
  /** Platform commission (internal only). */
  commission_rate: number | null;
  /** Supplier network a partner venue comes from. */
  supplier: string | null;
  /** Internal venues book directly; partner venues go through the supplier (quote request). */
  bookable: boolean;
}

/** What a supplier network's directory feed must provide per venue. */
export const partnerFeedSchema = z.array(
  z.object({
    ref: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    area: z.string().min(1).max(80),
    city: z.string().min(1).max(80),
    address: z.string().max(200).default(""),
    capacity: z.number().int().positive(),
    min_spend_inr: z.number().nonnegative(),
    private_dining: z.boolean().default(false),
  })
);
export type PartnerFeed = z.infer<typeof partnerFeedSchema>;

export interface SupplierNetwork {
  id: string;
  name: string;
  /** The network's current listings. May throw or be slow; callers time-box it. */
  fetchListings(): Promise<PartnerFeed>;
}

export function partnerToDirectory(network: Pick<SupplierNetwork, "id" | "name">, feed: PartnerFeed): DirectoryVenue[] {
  return feed.map((p) => ({
    id: `${network.id}:${p.ref}`,
    tier: "partner",
    name: p.name,
    neighborhood: p.area,
    city: p.city,
    address: p.address,
    capacity_max: p.capacity,
    min_spend_inr: p.min_spend_inr,
    pdr_available: p.private_dining,
    gstin: null,
    commission_rate: null,
    supplier: network.name,
    bookable: false,
  }));
}

/** Demo supplier network; swap for a real feed with PARTNER_DIRECTORY_URL. */
export const mockPartnerNetwork: SupplierNetwork = {
  id: "bvx",
  name: "Bengaluru Venue Exchange",
  async fetchListings() {
    await new Promise((r) => setTimeout(r, 80)); // network-ish latency
    return [
      { ref: "BVX-101", name: "Lakeview Pavilion", area: "Whitefield", city: "Bengaluru", address: "ITPL Main Road, Whitefield", capacity: 250, min_spend_inr: 150000, private_dining: true },
      { ref: "BVX-114", name: "The Courtyard at HSR", area: "HSR Layout", city: "Bengaluru", address: "27th Main, Sector 2, HSR Layout", capacity: 90, min_spend_inr: 60000, private_dining: true },
      { ref: "BVX-122", name: "Indigo Rooftop", area: "MG Road", city: "Bengaluru", address: "Church Street, off MG Road", capacity: 70, min_spend_inr: 45000, private_dining: false },
      { ref: "BVX-130", name: "Teak & Tandoor", area: "Indiranagar", city: "Bengaluru", address: "12th Main, HAL 2nd Stage", capacity: 45, min_spend_inr: 30000, private_dining: true },
      { ref: "BVX-145", name: "Brewhouse 17", area: "Koramangala", city: "Bengaluru", address: "5th Block, Koramangala", capacity: 160, min_spend_inr: 80000, private_dining: false },
      { ref: "BVX-151", name: "Orchid Banquets", area: "Hebbal", city: "Bengaluru", address: "Outer Ring Road, Hebbal", capacity: 400, min_spend_inr: 250000, private_dining: true },
    ];
  },
};

/** A network served by an external HTTP feed (JSON array matching partnerFeedSchema). */
export function httpPartnerNetwork(url: string, name: string, fetchImpl: typeof fetch = fetch): SupplierNetwork {
  return {
    id: "ext",
    name,
    async fetchListings() {
      const res = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`Partner directory returned ${res.status}`);
      const parsed = partnerFeedSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Partner directory feed didn't match the expected schema");
      return parsed.data;
    },
  };
}

export type PartnerStatus = { network: string; status: "ok"; count: number } | { network: string; status: "unavailable"; error: string };

/**
 * Fetches a network's listings with a deadline. A slow or failing partner never
 * blocks internal results: it degrades to an empty list with a status.
 */
export async function fetchPartnersWithin(network: SupplierNetwork, timeoutMs: number): Promise<{ venues: DirectoryVenue[]; status: PartnerStatus }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const feed = await Promise.race([
      network.fetchListings(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    const venues = partnerToDirectory(network, feed);
    return { venues, status: { network: network.name, status: "ok", count: venues.length } };
  } catch (err) {
    return { venues: [], status: { network: network.name, status: "unavailable", error: err instanceof Error ? err.message : "unavailable" } };
  } finally {
    clearTimeout(timer);
  }
}
