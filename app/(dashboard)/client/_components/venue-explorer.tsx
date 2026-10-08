"use client";

import { useState } from "react";
import { ArrowUpRight, List, Map as MapIcon, MapPinned } from "lucide-react";

import { EmptyState } from "@/components/portal/empty-state";
import { RateCardPill } from "@/components/portal/pills";
import { ResponsiveSheetContent } from "@/components/portal/responsive-sheet";
import { VenueMap } from "@/components/portal/venue-map";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CatalogVenue } from "@/lib/catalog";
import { dietaryLabel } from "@/lib/quotes";
import { cn, formatINR } from "@/lib/utils";
import type { VenueOption as SearchOption, VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { AiVenueSearch } from "./ai-venue-search";
import { EventRequestForm, type VenueOption, type VenuePrefill } from "./event-request-form";
import { VenueCardBody } from "./venue-picker";

const fromPrice = (v: CatalogVenue) => (v.packages.length ? Math.min(...v.packages.map((p) => p.per_head_inr)) : null);
/** One card's data, shared by the list here and the wizard's VenuePicker. */
const toOption = (v: CatalogVenue): VenueOption => ({
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
const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L` : `₹${Math.round(n / 1000)}k`);

/**
 * Venue list and map side by side (desktop) or toggled from a glass dock (mobile).
 * Picking a venue — card, marker, or an AI search result — opens its drawer with
 * packages and the request form pre-set to that venue (and, from search, the
 * guest count and per-head estimate).
 */
export function VenueExplorer({
  venues,
  company,
  departments,
}: {
  venues: CatalogVenue[];
  company: { id: string; gstin: string };
  departments: { id: string; name: string }[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [prefill, setPrefill] = useState<VenuePrefill>();
  const selected = venues.find((v) => v.id === selectedId) ?? null;
  const options = venues.map(toOption);

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
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="venues-heading" className="text-fg text-[15px] font-semibold tracking-tight">
            Venues
          </h2>
          <p className="text-fg-subtle mt-0.5 text-[13px]">Prices are pre-GST; your company&apos;s rate card applies when you request.</p>
        </div>
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
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <ul className={cn("grid content-start gap-3 sm:grid-cols-2 lg:max-h-[34rem] lg:grid-cols-1 lg:overflow-y-auto lg:p-1 lg:pr-2 ", mobileView === "map" && "max-lg:hidden")}>
              {options.map((v) => {
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
                      className="panel-interactive group flex w-full cursor-pointer flex-col gap-2 p-3 text-left"
                    >
                      <VenueCardBody
                        venue={v}
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

            <div className={cn("lg:sticky lg:top-20 lg:self-start", mobileView === "list" && "max-lg:hidden")}>
              <VenueMap
                venues={venues.map((v) => ({
                  id: v.id,
                  name: v.name,
                  latitude: v.latitude,
                  longitude: v.longitude,
                  label: compact(v.rate_card?.minSpendOverride ?? v.min_spend_inr),
                }))}
                selectedId={selectedId}
                onSelect={pick}
                className="h-[60dvh] lg:h-[34rem]"
              />
            </div>
          </div>

          {/* Mobile list/map dock — floats above the bottom nav. */}
          <div className="pointer-events-none sticky bottom-[calc(5rem+var(--app-safe-bottom))] z-20 mt-4 flex justify-center lg:hidden">
            <div className="glass pointer-events-auto flex rounded-full p-1" role="group" aria-label="Venue view">
              {(["list", "map"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={mobileView === view}
                  onClick={() => setMobileView(view)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm capitalize transition",
                    mobileView === view ? "bg-fg text-canvas" : "text-fg-muted"
                  )}
                >
                  {view === "list" ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
                  {view}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <Sheet open={open && !!selected} onOpenChange={setOpen}>
        {/* The drawer is portaled outside the page, so it carries its own scope. */}
        <ResponsiveSheetContent wide className="border-line bg-canvas">
          {selected ? (
            <div className="grid gap-5 overflow-y-auto p-4 sm:p-5">
              <SheetHeader className="p-0 pr-10">
                <SheetTitle className="text-fg text-lg font-semibold tracking-tight">{selected.name}</SheetTitle>
                <SheetDescription>{selected.address}</SheetDescription>
                <div className="flex flex-wrap gap-2 pt-1">
                  {selected.rate_card ? <RateCardPill label={selected.rate_card.label} /> : null}
                  <span className="text-xs text-fg-subtle">
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
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="font-medium text-fg">{p.name}</span>
                          <span className="figure text-fg">{formatINR(p.per_head_inr)}<span className="text-fg-subtle">/head</span></span>
                        </div>
                        {p.description ? <p className="mt-0.5 text-xs text-fg-subtle">{p.description}</p> : null}
                        {p.dietary_tags.length ? (
                          <p className="mt-1 text-xs text-fg-faint">{p.dietary_tags.map(dietaryLabel).join(" · ")}</p>
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
                />
              </div>
            </div>
          ) : null}
        </ResponsiveSheetContent>
      </Sheet>
    </section>
  );
}
