import type { DirectoryVenue, VenueTier } from "@/lib/venues/partner-network";

export const SORT_KEYS = ["name", "neighborhood", "capacity_max", "min_spend_inr", "commission_rate"] as const;
export type VenueSortKey = (typeof SORT_KEYS)[number];
export const PAGE_SIZES = [10, 25, 50] as const;

export type VenueQuery = {
  q: string;
  tier: "" | VenueTier;
  area: string;
  pdr: "" | "yes" | "no";
  minCapacity: number;
  sort: VenueSortKey;
  dir: "asc" | "desc";
  page: number;
  size: (typeof PAGE_SIZES)[number];
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Parses URL search params into a query, falling back to defaults on anything invalid. */
export function parseVenueQuery(params: Params): VenueQuery {
  const sort = one(params.sort) as VenueSortKey;
  const size = Number(one(params.size)) as VenueQuery["size"];
  const pdr = one(params.pdr);
  const tier = one(params.tier);
  return {
    q: one(params.q).trim().slice(0, 100),
    tier: tier === "internal" || tier === "partner" ? tier : "",
    area: one(params.area).trim(),
    pdr: pdr === "yes" || pdr === "no" ? pdr : "",
    minCapacity: Math.max(0, Math.floor(Number(one(params.min)) || 0)),
    sort: SORT_KEYS.includes(sort) ? sort : "name",
    dir: one(params.dir) === "desc" ? "desc" : "asc",
    page: Math.max(1, Math.floor(Number(one(params.page)) || 1)),
    size: PAGE_SIZES.includes(size) ? size : 10,
  };
}

/** Link to /venues with this query, omitting defaults so URLs stay short. */
export function venueHref(q: VenueQuery, patch: Partial<VenueQuery> = {}): string {
  const v = { ...q, ...patch };
  const p = new URLSearchParams();
  if (v.q) p.set("q", v.q);
  if (v.tier) p.set("tier", v.tier);
  if (v.area) p.set("area", v.area);
  if (v.pdr) p.set("pdr", v.pdr);
  if (v.minCapacity) p.set("min", String(v.minCapacity));
  if (v.sort !== "name") p.set("sort", v.sort);
  if (v.dir !== "asc") p.set("dir", v.dir);
  if (v.page > 1) p.set("page", String(v.page));
  if (v.size !== 10) p.set("size", String(v.size));
  const s = p.toString();
  return s ? `/venues?${s}` : "/venues";
}

export function applyVenueQuery(venues: DirectoryVenue[], q: VenueQuery) {
  const needle = q.q.toLowerCase();
  const filtered = venues
    .filter((v) => !needle || [v.name, v.address, v.neighborhood, v.gstin ?? "", v.supplier ?? ""].some((s) => s.toLowerCase().includes(needle)))
    .filter((v) => !q.tier || v.tier === q.tier)
    .filter((v) => !q.area || v.neighborhood === q.area)
    .filter((v) => !q.pdr || v.pdr_available === (q.pdr === "yes"))
    .filter((v) => v.capacity_max >= q.minCapacity)
    .sort((a, b) => {
      const x = a[q.sort];
      const y = b[q.sort];
      // Nulls (e.g. partner venues have no commission) sort last either way.
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const cmp = typeof x === "string" ? x.localeCompare(String(y)) : Number(x) - Number(y);
      return q.dir === "asc" ? cmp : -cmp;
    });

  const pageCount = Math.max(1, Math.ceil(filtered.length / q.size));
  const page = Math.min(q.page, pageCount);
  return {
    total: filtered.length,
    page,
    pageCount,
    rows: filtered.slice((page - 1) * q.size, page * q.size),
  };
}
