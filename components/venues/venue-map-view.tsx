"use client";

import { useEffect, useRef, useState } from "react";
import { DoorClosed, Heart, MapPin, MapPinOff, Star, Timer, UserCheck, Users } from "lucide-react";

import { PolicyBadge } from "@/components/policy/policy-badge";
import { VenuePhoto } from "@/components/venues/venue-photo";
import { VenueMap, type MapVenue } from "@/components/portal/venue-map";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import type { OfficeLocation, VenuePolicyStatus } from "@/lib/venues/discovery";
import { signalLabels, type VenueSignals } from "@/lib/venues/signals";

const SIGNAL_ICON = { favorite: Heart, rated: Star, coworkers: Users, you: UserCheck, fast: Timer } as const;

const isLocated = (v: MapVenue) => v.latitude != null && v.longitude != null;

/** One card beside the map: the pin's data plus what the card shows. */
export interface MapVenueCard extends MapVenue {
  neighborhood: string;
  city: string;
  capacity_max: number;
  pdr_available: boolean;
  tier: "internal" | "partner";
  supplier: string | null;
  /** e.g. "1.8 km from HQ" (officeDistanceLabel); null without an office or out of town. */
  distance: string | null;
  /** The viewer's company policy fit; undefined for admins. */
  policy?: VenuePolicyStatus;
  signals?: VenueSignals;
  /** Cover photo URL, or null. */
  photo_url?: string | null;
}

/**
 * The /venues directory's Map view: every match as a card in a scrolling list
 * beside a sticky map (map on top on phones), like a stay-search page. Hovering
 * a card raises its pin and hovering a pin highlights its card; either one,
 * clicked, opens the venue in the inspector, whose venue is highlighted on
 * both sides. Venues without coordinates (partners that haven't set one) are
 * listed under their own heading. actions: per-venue row actions (RFP, book) rendered by the page.
 */
export function VenueMapView({
  venues,
  office,
  actions = {},
}: {
  venues: MapVenueCard[];
  office: OfficeLocation | null;
  actions?: Record<string, React.ReactNode>;
}) {
  const { state, inspect } = useWorkspace();
  const selectedId = state.inspecting?.kind === "venue" ? state.inspecting.id : null;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const pinned = venues.filter(isLocated);
  const unpinned = venues.filter((v) => !isLocated(v));

  // A pin picked on the map brings its card into view.
  useEffect(() => {
    if (selectedId) cards.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const card = (v: MapVenueCard) => (
    <li
      key={v.id}
      ref={(el) => {
        if (el) cards.current.set(v.id, el);
        else cards.current.delete(v.id);
      }}
      onMouseEnter={() => setHoveredId(v.id)}
      onMouseLeave={() => setHoveredId(null)}
      data-selected={v.id === selectedId}
      data-hovered={v.id === hoveredId}
      className="panel-interactive data-[hovered=true]:border-plum data-[selected=true]:border-plum relative grid gap-2 p-4"
    >
      <VenueCard venue={v} onOpen={() => inspect("venue", v.id)} />
      {actions[v.id] ? <div className="relative -ml-2 flex gap-1">{actions[v.id]}</div> : null}
    </li>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="max-lg:order-last">
        <p className="text-fg-subtle mb-2 font-mono text-caption tabular-nums">
          {venues.length} venue{venues.length === 1 ? "" : "s"}
          {unpinned.length ? ` · ${pinned.length} on the map` : ""}
        </p>
        {/* One scroll area: pinned venues first, then any without a location under their own heading. */}
        <div className="grid content-start gap-4 lg:max-h-[calc(100dvh-14rem)] lg:min-h-[28rem] lg:overflow-y-auto lg:p-1 lg:pr-2">
          {pinned.length ? <ul className="grid content-start gap-2" aria-label="Venues on the map">{pinned.map(card)}</ul> : null}
          {unpinned.length ? (
            <section aria-labelledby="unpinned-heading" className="grid gap-2">
              <h3 id="unpinned-heading" className="text-fg-subtle flex items-center gap-1.5 text-caption font-medium">
                <MapPinOff className="size-3.5" aria-hidden />
                {unpinned.length} venue{unpinned.length === 1 ? "" : "s"} without a location
              </h3>
              <ul className="grid content-start gap-2">{unpinned.map(card)}</ul>
            </section>
          ) : null}
        </div>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <VenueMap
          venues={venues}
          selectedId={selectedId}
          onSelect={(id) => inspect("venue", id)}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          office={office}
          className="h-[45dvh] lg:h-[calc(100dvh-12rem)] lg:min-h-[28rem]"
        />
      </div>
    </div>
  );
}

function VenueCard({ venue: v, onOpen }: { venue: MapVenueCard; onOpen: () => void }) {
  const social = signalLabels(v.signals);
  return (
    <>
      {v.photo_url ? <VenuePhoto url={v.photo_url} className="aspect-[16/9] w-full rounded-md" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The stretched button makes the whole card open the venue; actions sit above it. */}
          <button type="button" onClick={onOpen} className="text-fg line-clamp-2 text-left text-body leading-snug font-medium after:absolute after:inset-0 after:content-['']">
            {v.name}
          </button>
          <p className="text-fg-subtle mt-0.5 truncate text-caption">
            {v.neighborhood} · {v.city}
            {v.tier === "partner" ? ` · partner${v.supplier ? ` · ${v.supplier}` : ""}` : ""}
          </p>
        </div>
        <span className="text-fg shrink-0 font-mono text-meta tabular-nums" title="Minimum spend">
          {v.label}
        </span>
      </div>

      <div className="text-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden /> Up to <span className="figure text-fg-muted">{v.capacity_max}</span>
        </span>
        {v.pdr_available ? (
          <span className="inline-flex items-center gap-1">
            <DoorClosed className="size-3.5" aria-hidden /> Private room
          </span>
        ) : null}
        {v.distance ? (
          <span className="inline-flex items-center gap-1" title="Straight-line distance">
            <MapPin className="size-3.5" aria-hidden /> {v.distance}
          </span>
        ) : null}
      </div>

      {social.length || v.policy ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {v.policy ? <PolicyBadge status={v.policy.status} range={"range" in v.policy ? v.policy.range : undefined} reason={"reason" in v.policy ? v.policy.reason : undefined} /> : null}
          {social.map(({ key, label }) => {
            const Icon = SIGNAL_ICON[key];
            return (
              <span key={key} className={cn("inline-flex items-center gap-1 text-caption font-medium", key === "favorite" ? "text-fg" : "text-fg-muted")}>
                <Icon className={cn("size-3.5", key === "favorite" && "text-coral fill-current", key === "rated" && "text-gold-ink fill-current")} aria-hidden /> {label}
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
