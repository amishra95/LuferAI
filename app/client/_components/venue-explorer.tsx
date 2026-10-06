"use client";

import { useState } from "react";
import { DoorClosed, List, Map as MapIcon, Users } from "lucide-react";

import { RateCardPill } from "@/components/portal/pills";
import { ResponsiveSheetContent } from "@/components/portal/responsive-sheet";
import { VenueMap } from "@/components/portal/venue-map";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CatalogVenue } from "@/lib/catalog";
import { dietaryLabel } from "@/lib/quotes";
import { cn, formatINR } from "@/lib/utils";
import type { VenueOption as SearchOption, VenueSearchFilters } from "@/lib/ai/venue-sourcing";
import { AiVenueSearch } from "./ai-venue-search";
import { EventRequestForm, type VenuePrefill } from "./event-request-form";

const fromPrice = (v: CatalogVenue) => (v.packages.length ? Math.min(...v.packages.map((p) => p.per_head_inr)) : null);
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
          <h2 id="venues-heading" className="text-lg font-semibold text-zinc-50">
            Venues
          </h2>
          <p className="text-sm text-zinc-400">Prices are pre-GST; your company&apos;s rate card applies when you request.</p>
        </div>
      </div>

      <div className="mb-4">
        <AiVenueSearch companyId={company.id} onSelect={pickFromSearch} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ul className={cn("grid content-start gap-3 lg:max-h-[34rem] lg:overflow-y-auto lg:pr-1", mobileView === "map" && "max-lg:hidden")}>
          {venues.map((v) => {
            const from = fromPrice(v);
            const diets = [...new Set(v.packages.flatMap((p) => p.dietary_tags))];
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => pick(v.id)}
                  onMouseEnter={() => setSelectedId(v.id)}
                  aria-current={v.id === selectedId ? "true" : undefined}
                  className={cn(
                    "w-full rounded-xl border bg-zinc-900 p-4 text-left transition",
                    v.id === selectedId
                      ? "border-zinc-500 shadow-[0_0_24px_-10px] shadow-emerald-400/60"
                      : "border-zinc-800/60 hover:border-zinc-700"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-50">{v.name}</div>
                      <div className="text-sm text-zinc-400">{v.neighborhood}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-medium text-zinc-50 tabular-nums">{from != null ? `${formatINR(from)}/head` : "—"}</div>
                      <div className="text-xs text-zinc-500">from</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden /> Up to {v.capacity_max}
                    </span>
                    {v.pdr_available ? (
                      <span className="inline-flex items-center gap-1">
                        <DoorClosed className="size-3.5" aria-hidden /> Private room
                      </span>
                    ) : null}
                    <span className="tabular-nums">Min {compact(v.rate_card?.minSpendOverride ?? v.min_spend_inr)}</span>
                    {v.rate_card ? <RateCardPill label={v.rate_card.label} /> : null}
                  </div>
                  {diets.length ? <p className="mt-2 text-xs text-zinc-500">{diets.map(dietaryLabel).join(" · ")}</p> : null}
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
        <div className="glass pointer-events-auto flex rounded-full p-1 shadow-lg" role="group" aria-label="Venue view">
          {(["list", "map"] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={mobileView === view}
              onClick={() => setMobileView(view)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm capitalize transition",
                mobileView === view ? "bg-zinc-50 text-zinc-950" : "text-zinc-300"
              )}
            >
              {view === "list" ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
              {view}
            </button>
          ))}
        </div>
      </div>

      <Sheet open={open && !!selected} onOpenChange={setOpen}>
        <ResponsiveSheetContent wide>
          {selected ? (
            <div className="grid gap-6 overflow-y-auto p-5 sm:p-6">
              <SheetHeader className="p-0 pr-10">
                <SheetTitle className="text-xl text-zinc-50">{selected.name}</SheetTitle>
                <SheetDescription>{selected.address}</SheetDescription>
                <div className="flex flex-wrap gap-2 pt-1">
                  {selected.rate_card ? <RateCardPill label={selected.rate_card.label} /> : null}
                  <span className="text-xs text-zinc-400">
                    Up to {selected.capacity_max} guests · min spend {formatINR(selected.rate_card?.minSpendOverride ?? selected.min_spend_inr)}
                    {selected.pdr_available ? " · private dining room" : ""}
                  </span>
                </div>
              </SheetHeader>

              {selected.packages.length ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium text-zinc-300">Menu packages</h3>
                  <ul className="grid gap-2">
                    {selected.packages.map((p) => (
                      <li key={p.id} className="rounded-lg border border-zinc-800/60 bg-zinc-900 p-3">
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="font-medium text-zinc-100">{p.name}</span>
                          <span className="text-zinc-50 tabular-nums">{formatINR(p.per_head_inr)}/head</span>
                        </div>
                        {p.description ? <p className="mt-0.5 text-xs text-zinc-400">{p.description}</p> : null}
                        {p.dietary_tags.length ? (
                          <p className="mt-1 text-xs text-zinc-500">{p.dietary_tags.map(dietaryLabel).join(" · ")}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-3">
                <h3 className="text-sm font-medium text-zinc-300">Request this venue</h3>
                <EventRequestForm
                  key={selected.id}
                  companyId={company.id}
                  companyGstin={company.gstin}
                  defaultVenueId={selected.id}
                  departments={departments}
                  prefill={prefill}
                  venues={venues.map(({ id, name, neighborhood, city, gstin, capacity_max, min_spend_inr, pdr_available }) => ({
                    id,
                    name,
                    neighborhood,
                    city,
                    gstin,
                    capacity_max,
                    min_spend_inr,
                    pdr_available,
                  }))}
                />
              </div>
            </div>
          ) : null}
        </ResponsiveSheetContent>
      </Sheet>
    </section>
  );
}
