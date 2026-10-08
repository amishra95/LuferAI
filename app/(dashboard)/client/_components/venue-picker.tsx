"use client";

import { useId } from "react";
import { AlertTriangle, BadgePercent, Check, DoorClosed, Users } from "lucide-react";

import { cn, formatINR } from "@/lib/utils";

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
}

const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L` : `₹${Math.round(n / 1000)}k`);

/**
 * The inside of a concierge venue card: name, area, starting price, capacity,
 * minimum spend, rate card and (with a guest count) whether the group fits.
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
}: {
  venue: VenuePickerOption;
  /** Guests entered so far; 0 hides the fit hint. */
  guests?: number;
  /** Top-right affordance (a radio dot, an arrow). Decorative. */
  indicator?: React.ReactNode;
  metaId?: string;
}) {
  const tooSmall = guests > 0 && guests > v.capacity_max;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg truncate text-[15px] leading-tight font-semibold tracking-tight">{v.name}</p>
          <p className="text-fg-subtle mt-1 truncate text-[12px]">
            {v.neighborhood} · {v.city}
          </p>
        </div>
        {indicator}
      </div>

      <p className="flex items-baseline gap-1.5">
        {v.from_per_head_inr != null ? (
          <>
            <span className="text-fg-subtle text-[11px]">from</span>
            <span className="text-[17px] font-semibold tracking-tight text-amber-400 tabular-nums">{formatINR(v.from_per_head_inr)}</span>
            <span className="text-fg-subtle text-[11px]">/ head</span>
          </>
        ) : (
          <span className="text-fg-subtle text-[12px]">Packages on request</span>
        )}
      </p>

      <div id={metaId} className="text-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden /> Up to {v.capacity_max}
        </span>
        {v.pdr_available ? (
          <span className="inline-flex items-center gap-1">
            <DoorClosed className="size-3.5" aria-hidden /> Private room
          </span>
        ) : null}
        <span className="tabular-nums">
          <span className="sr-only">Minimum spend </span>
          <span aria-hidden>Min </span>
          {compact(v.min_spend_inr)}
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

      {v.rate_card_label || v.dietary?.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {v.rate_card_label ? (
            <span
              title="Your company's negotiated rate applies"
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11.5px] font-medium text-amber-300"
            >
              <BadgePercent className="size-3.5" aria-hidden /> Rate card {v.rate_card_label}
            </span>
          ) : null}
          {v.dietary?.length ? <span className="text-fg-faint text-[11.5px]">{v.dietary.join(" · ")}</span> : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Venue choice as a grid of concierge cards, one radio per card. Native radios
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
}: {
  venues: VenuePickerOption[];
  value: string;
  onChange: (id: string) => void;
  name?: string;
  /** Guests entered so far, for the fit hint (0 or NaN hides it). */
  partySize?: number;
  error?: string;
}) {
  const id = useId();
  const guests = partySize && partySize > 0 ? partySize : 0;

  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined} className="grid min-w-0 gap-3">
      <legend className="mb-3 flex w-full items-baseline justify-between gap-3">
        <span className="text-fg text-[13px] font-medium tracking-tight">Choose your venue</span>
        <span className="text-fg-subtle font-mono text-[11px] tabular-nums">
          {venues.length} {venues.length === 1 ? "venue" : "venues"} · pre-GST
        </span>
      </legend>

      <div className="grid gap-3 sm:grid-cols-2">
        {venues.map((v) => {
          const selected = v.id === value;
          const metaId = `${id}-${v.id}-meta`;
          return (
            <label
              key={v.id}
              className={cn(
                "concierge-card animate-in fade-in flex cursor-pointer flex-col gap-3 p-4 duration-300",
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
                      "grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200",
                      selected ? "badge-pulse border-amber-400 bg-amber-400 text-zinc-950" : "border-line-strong"
                    )}
                  >
                    {selected ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                }
              />
            </label>
          );
        })}
      </div>

      {error ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
