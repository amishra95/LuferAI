"use client";

import { useId, useState } from "react";
import { AlertTriangle, BadgePercent, Check, DoorClosed, Heart, MapPin, Search, Timer, UserCheck, Users } from "lucide-react";

import { PolicyBadge } from "@/components/policy/policy-badge";
import { VenuePhoto } from "@/components/venues/venue-photo";
import { matchScore } from "@/lib/search/match";
import { cn, formatINR } from "@/lib/utils";
import type { VenuePolicyStatus } from "@/lib/venues/discovery";
import { signalLabels, type VenueSignals } from "@/lib/venues/signals";

const SIGNAL_ICON = { favorite: Heart, coworkers: Users, you: UserCheck, fast: Timer } as const;
const SIGNAL_TITLE = {
  favorite: "One of your company's most-booked venues this year",
  coworkers: "Colleagues at your company booked here this year",
  you: "You booked here this year",
  fast: "Typical time for this venue to accept a request, across companies",
} as const;

export interface VenuePickerOption {
  id: string;
  name: string;
  neighborhood: string;
  city: string;
  capacity_max: number;
  /** The company's effective minimum spend here (rate-card override, else list). */
  min_spend_inr: number;
  pdr_available: boolean;
  /** Cheapest active menu package, per head; null when the venue has none. */
  from_per_head_inr: number | null;
  /** Corporate rate card label (e.g. "−12%"), or null for list pricing. */
  rate_card_label: string | null;
  /** Dietary options across the venue's packages, already labelled. */
  dietary?: string[];
  /** Cover photo URL; null or absent when the venue has none. */
  photo_url?: string | null;
}

const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L` : `₹${Math.round(n / 1000)}k`);

/**
 * The inside of a venue card: name, area, starting price, capacity,
 * minimum spend, rate card, (with a guest count) whether the group fits and,
 * where given, its policy fit and distance from the office.
 * Shared by the booking wizard's VenuePicker and the client portal's venue
 * list, which wrap it in a radio label and a button respectively.
 *
 * Styled for the `.concierge` scope (app/globals.css).
 */
export function VenueCardBody({
  venue: v,
  guests = 0,
  indicator,
  metaId,
  policy,
  distance,
  signals,
}: {
  venue: VenuePickerOption;
  /** Guests entered so far; 0 hides the fit hint. */
  guests?: number;
  /** Top-right affordance (a radio dot, an arrow). Decorative. */
  indicator?: React.ReactNode;
  metaId?: string;
  /** The company's policy fit at this venue's minimums (venuePolicyStatus). */
  policy?: VenuePolicyStatus;
  /** e.g. "1.8 km from HQ" (officeDistanceLabel). */
  distance?: string | null;
  /** "Booked by 3 coworkers", "Company favorite"… (lib/venues/signals.ts). */
  signals?: VenueSignals;
}) {
  const tooSmall = guests > 0 && guests > v.capacity_max;
  const social = signalLabels(signals);
  return (
    <>
      {v.photo_url ? <VenuePhoto url={v.photo_url} className="-mx-5 -mt-5 mb-1 aspect-[16/9] w-[calc(100%+2.5rem)] max-w-none rounded-t-[inherit]" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg line-clamp-2 text-body leading-snug font-medium">{v.name}</p>
          <p className="text-fg-subtle mt-0.5 truncate text-caption">
            {v.neighborhood} · {v.city}
          </p>
        </div>
        {indicator}
      </div>

      <p className="flex items-baseline gap-1.5">
        {v.from_per_head_inr != null ? (
          <>
            <span className="text-fg-subtle text-caption">from</span>
            <span className="figure text-fg text-meta font-medium">{formatINR(v.from_per_head_inr)}</span>
            <span className="text-fg-subtle text-caption">/ head</span>
          </>
        ) : (
          <span className="text-fg-subtle text-caption">Packages on request</span>
        )}
      </p>

      <div id={metaId} className="text-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden /> Up to <span className="figure text-fg-muted">{v.capacity_max}</span>
        </span>
        {v.pdr_available ? (
          <span className="inline-flex items-center gap-1">
            <DoorClosed className="size-3.5" aria-hidden /> Private room
          </span>
        ) : null}
        <span>
          <span className="sr-only">Minimum spend </span>
          <span aria-hidden>Min </span>
          <span className="figure text-fg-muted">{compact(v.min_spend_inr)}</span>
        </span>
        {guests > 0 ? (
          tooSmall ? (
            <span className="text-rose inline-flex items-center gap-1">
              <AlertTriangle className="size-3.5" aria-hidden /> Too small for {guests}
            </span>
          ) : (
            <span className="text-sage inline-flex items-center gap-1">
              <Check className="size-3.5" aria-hidden /> Fits {guests}
            </span>
          )
        ) : null}
      </div>

      {social.length ? (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Signals">
          {social.map(({ key, label }) => {
            const Icon = SIGNAL_ICON[key];
            return (
              <li key={key} title={SIGNAL_TITLE[key]} className={cn("inline-flex items-center gap-1 text-caption font-medium", key === "favorite" ? "text-fg" : "text-fg-muted")}>
                <Icon className={cn("size-3.5", key === "favorite" && "text-coral fill-current")} aria-hidden /> {label}
              </li>
            );
          })}
        </ul>
      ) : null}

      {v.rate_card_label || v.dietary?.length || policy || distance ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {policy ? <PolicyBadge status={policy.status} range={"range" in policy ? policy.range : undefined} reason={"reason" in policy ? policy.reason : undefined} /> : null}
          {distance ? (
            <span
              title="Straight-line distance"
              className="border-line text-fg-muted rounded-badge inline-flex items-center gap-1 border px-2.5 py-0.5 text-caption leading-4 font-medium"
            >
              <MapPin className="size-3.5" aria-hidden /> {distance}
            </span>
          ) : null}
          {v.rate_card_label ? (
            <span
              title="Your company's negotiated rate applies"
              className="border-line text-fg-muted rounded-badge inline-flex items-center gap-1 border px-2.5 py-0.5 text-caption leading-4 font-medium"
            >
              <BadgePercent className="size-3.5" aria-hidden /> Rate card {v.rate_card_label}
            </span>
          ) : null}
          {v.dietary?.length ? <span className="text-fg-faint text-caption">{v.dietary.join(" · ")}</span> : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Venue choice as a grid of cards, one radio per card. Native radios
 * (visually hidden) keep the form working without JS, give arrow-key movement
 * within the group, and submit `name` like the select it replaces. With a
 * guest count, each card says whether the group fits.
 */
export function VenuePicker({
  venues,
  value,
  onChange,
  name = "venue_id",
  partySize,
  error,
  searchable = false,
}: {
  venues: VenuePickerOption[];
  value: string;
  onChange: (id: string) => void;
  name?: string;
  /** Guests entered so far, for the fit hint (0 or NaN hides it). */
  partySize?: number;
  error?: string;
  /** A search box over name and area (the manual booking modal); the chosen venue always stays listed. */
  searchable?: boolean;
}) {
  const id = useId();
  const guests = partySize && partySize > 0 ? partySize : 0;
  const [query, setQuery] = useState("");
  const shown = searchable && query.trim() ? venues.filter((v) => v.id === value || matchScore(query, v.name, `${v.neighborhood} ${v.city}`) !== null) : venues;

  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined} className="grid min-w-0 gap-3">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
        <span className="label-mono">Choose your venue</span>
        <span className="text-fg-subtle font-mono text-caption tabular-nums">
          {venues.length} {venues.length === 1 ? "venue" : "venues"} · pre-GST
        </span>
      </legend>

      {searchable ? (
        <div className="relative">
          <Search className="text-fg-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search venues by name or area"
            aria-label="Search venues"
            className="field pl-9"
          />
        </div>
      ) : null}

      {shown.length === 0 ? <p className="text-fg-subtle text-meta">No venues match “{query.trim()}”.</p> : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((v) => {
          const selected = v.id === value;
          const metaId = `${id}-${v.id}-meta`;
          return (
            <label
              key={v.id}
              className={cn(
                "panel-interactive flex cursor-pointer flex-col gap-2 p-5",
                guests > v.capacity_max && !selected && "opacity-70 hover:opacity-100"
              )}
            >
              <input
                type="radio"
                name={name}
                value={v.id}
                checked={selected}
                onChange={() => onChange(v.id)}
                aria-describedby={error ? `${metaId} ${id}-error` : metaId}
                className="sr-only"
              />
              <VenueCardBody
                venue={v}
                guests={guests}
                metaId={metaId}
                indicator={
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full border",
                      selected ? "border-selected bg-selected text-on-selected" : "border-line-strong"
                    )}
                  >
                    {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
                  </span>
                }
              />
            </label>
          );
        })}
      </div>

      {error ? (
        <p id={`${id}-error`} className="text-destructive text-caption">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
