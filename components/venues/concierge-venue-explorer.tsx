"use client";

import { useMemo, useState } from "react";
import { SearchX } from "lucide-react";

import { ConciergeVenueCard } from "@/components/venues/concierge-card";
import { segmentClass } from "@/components/portal/segment";
import {
  applyConciergeFilters,
  CAPACITY_BANDS,
  conciergeFilterQuery,
  SORTS,
  SPACE_TYPES,
  type ConciergeCard,
  type ConciergeFilters,
} from "@/lib/venues/concierge-cards";
import { cn } from "@/lib/utils";

const DEFAULTS = { guests: "", space: "", inPolicy: false, sort: "recommended" } as const;

/**
 * /venues for companies: the concierge venues with City, Guests, Space,
 * In-policy and Sort. Filtering is instant (all venues are on the page) and
 * mirrored into the URL, so a filtered view can be shared or reloaded.
 */
export function ConciergeVenueExplorer({ venues, initial, heading }: { venues: ConciergeCard[]; initial: ConciergeFilters; heading: string | null }) {
  const [filters, setFilters] = useState(initial);
  const cities = useMemo(() => [...new Set(venues.map((v) => v.city))].sort(), [venues]);
  const shown = useMemo(() => applyConciergeFilters(venues, filters), [venues, filters]);
  // The policy toggle only means something once a venue is priced against the company's rules.
  const hasPolicy = venues.some((v) => v.policy);
  const filtered = filters.guests !== "" || filters.space !== "" || filters.inPolicy || (cities.length > 1 && filters.city !== "");

  const update = (patch: Partial<ConciergeFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const url = new URL(window.location.href);
    window.history.replaceState(window.history.state, "", `${url.pathname}${conciergeFilterQuery(next, cities)}${url.hash}`);
  };
  const clear = () => update({ ...DEFAULTS, city: cities.length === 1 ? cities[0] : "" });

  return (
    <section aria-labelledby="concierge-venues-heading">
      <h2 id="concierge-venues-heading" className={heading === null ? "sr-only" : "text-fg mb-3 text-body font-semibold tracking-tight"}>
        {heading ?? "Venues"}
      </h2>

      <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filter venues">
        <label>
          <span className="sr-only">City</span>
          <select value={filters.city} onChange={(e) => update({ city: e.target.value })} className="field h-8 w-auto pr-8 text-meta">
            {cities.length > 1 ? <option value="">All cities</option> : null}
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>

        <div className="border-line-strong bg-surface flex h-8 w-full items-center gap-0.5 rounded-[var(--radius-control)] border px-0.5 sm:w-auto" role="radiogroup" aria-label="Guests">
          {(Object.keys(CAPACITY_BANDS) as (keyof typeof CAPACITY_BANDS)[]).map((band) => (
            <button
              key={band || "any"}
              type="button"
              role="radio"
              aria-checked={filters.guests === band}
              onClick={() => update({ guests: band })}
              className={cn(segmentClass(filters.guests === band), "h-6 flex-1 justify-center px-2 text-caption sm:flex-none")}
            >
              {band === "" ? "Any size" : CAPACITY_BANDS[band]}
            </button>
          ))}
        </div>

        <label>
          <span className="sr-only">Space</span>
          <select value={filters.space} onChange={(e) => update({ space: e.target.value as ConciergeFilters["space"] })} className="field h-8 w-auto pr-8 text-meta">
            {(Object.keys(SPACE_TYPES) as (keyof typeof SPACE_TYPES)[]).map((s) => (
              <option key={s || "any"} value={s}>
                {SPACE_TYPES[s]}
              </option>
            ))}
          </select>
        </label>

        {hasPolicy ? (
          <button type="button" aria-pressed={filters.inPolicy} onClick={() => update({ inPolicy: !filters.inPolicy })} className={cn(segmentClass(filters.inPolicy), "border-line-strong h-8 border")}>
            In policy only
          </button>
        ) : null}

        <label className="ml-auto flex items-center gap-2">
          <span className="text-fg-subtle text-caption">Sort</span>
          <select value={filters.sort} onChange={(e) => update({ sort: e.target.value as ConciergeFilters["sort"] })} className="field h-8 w-auto pr-8 text-meta">
            {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((s) => (
              <option key={s} value={s}>
                {SORTS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered ? (
        <p className="text-fg-subtle -mt-2 mb-4 text-meta" role="status">
          {shown.length} of {venues.length} venues{" "}
          <button type="button" onClick={clear} className="text-link underline-offset-2 hover:underline">
            Clear filters
          </button>
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((v) => (
            <ConciergeVenueCard key={v.id} venue={v} />
          ))}
        </ul>
      ) : (
        <div className="panel grid place-items-center gap-3 px-6 py-12 text-center">
          <SearchX className="text-fg-subtle size-6" aria-hidden />
          <p className="text-fg text-body font-medium">No venues match these filters</p>
          <button type="button" onClick={clear} className="btn">
            Clear filters
          </button>
        </div>
      )}
    </section>
  );
}
