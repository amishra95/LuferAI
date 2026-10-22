"use client";

import { useState } from "react";
import { ArrowUpRight, List, Map as MapIcon, MapPinned } from "lucide-react";

import { EmptyState } from "@/components/portal/empty-state";
import { RateCardPill } from "@/components/portal/pills";
import { ResponsiveSheetContent } from "@/components/portal/responsive-sheet";
import { segmentClass } from "@/components/portal/segment";
import { VenueMap } from "@/components/portal/venue-map";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CatalogVenue } from "@/lib/catalog";
import { dietaryLabel } from "@/lib/quotes";
import { cn, formatINR } from "@/lib/utils";
import { distanceKm, formatOfficeDistance, officeDistanceLabel, POLICY_TONE, venuePolicyStatus, type OfficeLocation, type VenueCardRules } from "@/lib/venues/discovery";
import type { VenueOption as SearchOption, VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { AiVenueSearch } from "./ai-venue-search";
import { EventRequestForm, type VenuePrefill } from "./event-request-form";
import { VenueCardBody } from "./venue-picker";
import { toVenueOption } from "./venue-options";

const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L` : `₹${Math.round(n / 1000)}k`);

/**
 * Venue cards as a list, or (Map view) beside an interactive map: map on the
 * right on desktop, on top on phones. Cards and pins show the company's policy
 * fit; cards show the distance from the office. Picking a venue — card, marker,
 * or an AI search result — opens its drawer with packages and the request form
 * pre-set to that venue (and, from search, the guest count and per-head estimate).
 */
export function VenueExplorer({
  venues,
  company,
  departments,
  defaultPhone,
  policy = null,
  office = null,
  officeDistances = null,
}: {
  venues: CatalogVenue[];
  company: { id: string; gstin: string };
  departments: { id: string; name: string }[];
  /** The requester's saved mobile, prefilled in the request form. */
  defaultPhone?: string;
  /** The company's corporate_policies limits; null = no policy (every venue in policy). */
  policy?: VenueCardRules | null;
  /** The company's office, for distance badges and the map's office pin. */
  office?: OfficeLocation | null;
  /**
   * Metres from the office by venue id, from PostGIS; a venue missing is out of
   * range. null = not available, so badges are computed here instead.
   */
  officeDistances?: Record<string, number> | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [prefill, setPrefill] = useState<VenuePrefill>();
  const selected = venues.find((v) => v.id === selectedId) ?? null;
  const options = venues.map(toVenueOption);
  // Km from the office per venue, for the distance rule: PostGIS when it has the
  // venue (within its search radius), otherwise computed here.
  const officeKm = (venue: CatalogVenue): number | null => {
    const meters = officeDistances?.[venue.id];
    if (meters != null) return meters / 1000;
    return office && venue.latitude != null && venue.longitude != null ? distanceKm(office, { latitude: venue.latitude, longitude: venue.longitude }) : null;
  };
  const fit = new Map(options.map((o, i) => [o.id, venuePolicyStatus(policy, o, officeKm(venues[i]))]));
  const distanceLabel = (venue: CatalogVenue) => {
    if (!officeDistances) return officeDistanceLabel(office, venue);
    const meters = officeDistances[venue.id];
    return office && meters != null ? formatOfficeDistance(office, meters / 1000) : null;
  };

  const pick = (id: string) => {
    setSelectedId(id);
    setPrefill(undefined);
    setOpen(true);
  };

  // estimatedPerHead already covers the venue's minimum spend for this group.
  const pickFromSearch = (option: SearchOption, filters: VenueSearchFilters) => {
    setSelectedId(option.venue.id);
    setPrefill({ venueId: option.venue.id, partySize: filters.minCapacity, perHead: option.estimatedPerHead });
    setOpen(true);
  };

  return (
    <section aria-labelledby="venues-heading" className="relative">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="venues-heading" className="text-fg text-body font-semibold tracking-tight">
            Venues
          </h2>
          <p className="text-fg-subtle mt-0.5 text-meta">Prices are pre-GST; your company&apos;s rate card applies when you request.</p>
        </div>
        {venues.length ? (
          <div className="flex gap-1" role="group" aria-label="Venue view">
            {(["list", "map"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn(segmentClass(view === v), "gap-1.5")}>
                {v === "list" ? <List className="size-3.5" aria-hidden /> : <MapIcon className="size-3.5" aria-hidden />}
                {v === "list" ? "List view" : "Map view"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mb-4">
        <AiVenueSearch companyId={company.id} onSelect={pickFromSearch} />
      </div>

      {venues.length === 0 ? (
        <EmptyState
          icon={MapPinned}
          title="No venues in your catalogue yet"
          description="Venues appear here once they're onboarded for your company. Prices, rate cards and availability show up with them."
        />
      ) : (
        <div className={cn("grid gap-6", view === "map" && "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
          <ul
            className={cn(
              "grid content-start gap-3 sm:grid-cols-2",
              view === "map" ? "lg:max-h-[34rem] lg:grid-cols-1 lg:overflow-y-auto lg:p-1 lg:pr-2" : "lg:grid-cols-3"
            )}
          >
            {options.map((v, i) => {
              const active = v.id === selectedId;
              return (
                <li key={v.id} className="grid">
                  <button
                    type="button"
                    onClick={() => pick(v.id)}
                    onMouseEnter={() => setSelectedId(v.id)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`${v.name}, ${v.neighborhood}: view packages and request`}
                    data-selected={active}
                    className="panel-interactive group flex w-full cursor-pointer flex-col gap-2 p-5 text-left"
                  >
                    <VenueCardBody
                      venue={v}
                      policy={policy ? fit.get(v.id) : undefined}
                      distance={distanceLabel(venues[i])}
                      indicator={
                        <ArrowUpRight
                          aria-hidden
                          className={cn(
                            "size-3.5 shrink-0 group-hover:text-fg",
                            active ? "text-fg" : "text-fg-faint"
                          )}
                        />
                      }
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          {view === "map" ? (
            <div className="max-lg:order-first lg:sticky lg:top-20 lg:self-start">
              <VenueMap
                venues={venues.map((v) => ({
                  id: v.id,
                  name: v.name,
                  latitude: v.latitude,
                  longitude: v.longitude,
                  label: compact(v.rate_card?.minSpendOverride ?? v.min_spend_inr),
                  tone: policy ? POLICY_TONE[fit.get(v.id)?.status ?? "in_policy"] : undefined,
                }))}
                selectedId={selectedId}
                onSelect={pick}
                office={office}
                className="h-[45dvh] lg:h-[34rem]"
              />
            </div>
          ) : null}
        </div>
      )}

      <Sheet open={open && !!selected} onOpenChange={setOpen}>
        {/* The drawer is portaled outside the page, so it carries its own scope. */}
        <ResponsiveSheetContent wide className="border-line bg-canvas">
          {selected ? (
            <div className="grid gap-5 overflow-y-auto p-4 sm:p-5">
              <SheetHeader className="p-0 pr-10">
                <SheetTitle className="text-fg text-section font-semibold tracking-tight">{selected.name}</SheetTitle>
                <SheetDescription>{selected.address}</SheetDescription>
                <div className="flex flex-wrap gap-2 pt-1">
                  {selected.rate_card ? <RateCardPill label={selected.rate_card.label} /> : null}
                  <span className="text-caption text-fg-subtle">
                    Up to {selected.capacity_max} guests · min spend {formatINR(selected.rate_card?.minSpendOverride ?? selected.min_spend_inr)}
                    {selected.pdr_available ? " · private dining room" : ""}
                  </span>
                </div>
              </SheetHeader>

              {selected.packages.length ? (
                <div className="grid gap-2">
                  <h3 className="label-mono">Menu packages</h3>
                  <ul className="grid gap-2">
                    {selected.packages.map((p) => (
                      <li key={p.id} className="panel px-3 py-2.5">
                        <div className="flex justify-between gap-3 text-body">
                          <span className="font-medium text-fg">{p.name}</span>
                          <span className="figure text-fg">{formatINR(p.per_head_inr)}<span className="text-fg-subtle">/head</span></span>
                        </div>
                        {p.description ? <p className="mt-0.5 text-caption text-fg-subtle">{p.description}</p> : null}
                        {p.dietary_tags.length ? (
                          <p className="mt-1 text-caption text-fg-faint">{p.dietary_tags.map(dietaryLabel).join(" · ")}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-3">
                <h3 className="label-mono">Request this venue</h3>
                <EventRequestForm
                  key={selected.id}
                  companyId={company.id}
                  companyGstin={company.gstin}
                  defaultVenueId={selected.id}
                  departments={departments}
                  prefill={prefill}
                  venues={options}
                  defaultPhone={defaultPhone}
                />
              </div>
            </div>
          ) : null}
        </ResponsiveSheetContent>
      </Sheet>
    </section>
  );
}
