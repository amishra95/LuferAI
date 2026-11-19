"use client";

import { useState } from "react";
import { Dialog } from "radix-ui";
import { DoorClosed, MapPin, Users, X } from "lucide-react";

import { QuoteRequestButton } from "@/components/venues/quote-request-button";
import { VenuePhoto } from "@/components/venues/venue-photo";
import { categoryLabel, type ConciergeCard as Card } from "@/lib/venues/concierge-cards";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const guests = (n: number) => `Up to ${n.toLocaleString("en-IN")} guests`;

const POLICY = {
  in_policy: { label: "In policy", className: "bg-success-soft text-sage" },
  requires_manager: { label: "Needs approval", className: "bg-warn-soft text-warn" },
  requires_cfo: { label: "Needs CFO approval", className: "bg-warn-soft text-warn" },
} as const;

function PolicyBadge({ policy, className }: { policy: Card["policy"]; className?: string }) {
  if (!policy) return null;
  const p = POLICY[policy.status];
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-caption font-medium", p.className, className)} title={"reason" in policy ? policy.reason : undefined}>
      {p.label}
    </span>
  );
}

function Chip({ icon: Icon, children }: { icon?: typeof Users; children: React.ReactNode }) {
  return (
    <span className="bg-surface-raised text-fg-muted inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-caption whitespace-nowrap">
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}

function Facts({ venue }: { venue: Card }) {
  const category = categoryLabel(venue.category);
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip icon={Users}>{guests(venue.capacity)}</Chip>
      {venue.privateRoom ? <Chip icon={DoorClosed}>Private room</Chip> : null}
      {category ? <Chip>{category}</Chip> : null}
    </div>
  );
}

function Price({ venue }: { venue: Card }) {
  return venue.perHead !== null ? (
    <p className="text-fg text-meta">
      <span className="font-mono font-medium tabular-nums">From {inr(venue.perHead)}</span>
      <span className="text-fg-subtle"> / guest</span>
    </p>
  ) : (
    <p className="text-fg-subtle text-meta">Price on request</p>
  );
}

/** A venue the concierge quotes: photo, facts, price, details and "Request a quote". */
export function ConciergeVenueCard({ venue }: { venue: Card }) {
  return (
    <li
      className={cn(
        "bg-surface border-frame group flex flex-col overflow-hidden rounded-[var(--radius-card)] border shadow-[var(--shadow-card)]",
        "transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      )}
    >
      <div className="relative">
        <VenuePhoto url={venue.photos[0]} className="aspect-video w-full" />
        <PolicyBadge policy={venue.policy} className="absolute top-3 right-3 shadow-sm" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="text-fg truncate text-body font-medium">{venue.name}</h3>
          <p className="text-fg-subtle truncate text-caption">
            {venue.neighborhood} · {venue.city}
          </p>
        </div>
        <Facts venue={venue} />
      </div>
      <div className="border-line flex items-center justify-between gap-2 border-t px-4 py-3">
        <Price venue={venue} />
        <div className="flex shrink-0 items-center gap-1">
          <VenueDetails venue={venue} />
          <QuoteRequestButton venue={{ id: venue.id, name: venue.name }} className="btn-primary" />
        </div>
      </div>
    </li>
  );
}

/** "Details": every photo, the address with a map link, the facts and the request. */
function VenueDetails({ venue }: { venue: Card }) {
  const [shown, setShown] = useState(0);
  const category = categoryLabel(venue.category);
  const mapsUrl =
    venue.latitude !== null && venue.longitude !== null
      ? `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${venue.address || venue.neighborhood}, ${venue.city}`)}`;
  return (
    <Dialog.Root onOpenChange={(o) => o && setShown(0)}>
      <Dialog.Trigger className="btn btn-ghost h-8 px-2.5 text-caption">Details</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <Dialog.Content
          className={cn(
            "lufer bg-canvas border-line fixed z-50 flex flex-col overflow-hidden border shadow-2xl outline-none",
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-[var(--app-safe-bottom)]",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(40rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0"
          )}
        >
          <div className="overflow-y-auto">
            <div className="relative">
              <VenuePhoto url={venue.photos[shown]} className="aspect-video w-full" />
              <Dialog.Close className="btn btn-icon bg-surface/90 absolute top-3 right-3 size-8 border-transparent backdrop-blur" aria-label="Close">
                <X className="size-4" aria-hidden />
              </Dialog.Close>
            </div>
            {venue.photos.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto px-5 pt-3" role="group" aria-label="Photos">
                {venue.photos.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setShown(i)}
                    aria-label={`Photo ${i + 1} of ${venue.photos.length}`}
                    aria-pressed={i === shown}
                    className={cn("shrink-0 overflow-hidden rounded-md border-2 transition-colors", i === shown ? "border-accent" : "border-transparent opacity-80 hover:opacity-100")}
                  >
                    <VenuePhoto url={url} className="h-12 w-20" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid gap-4 px-5 pt-4 pb-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="text-fg text-section font-semibold tracking-tight">{venue.name}</Dialog.Title>
                  <Dialog.Description className="text-fg-subtle text-meta">
                    {venue.neighborhood} · {venue.city}
                  </Dialog.Description>
                </div>
                <PolicyBadge policy={venue.policy} className="shrink-0" />
              </div>
              <Facts venue={venue} />
              <dl className="border-line grid gap-2 border-t pt-4 text-meta">
                {venue.address ? (
                  <div className="flex gap-3">
                    <dt className="text-fg-subtle w-24 shrink-0">Address</dt>
                    <dd className="text-fg">{venue.address}</dd>
                  </div>
                ) : null}
                <div className="flex gap-3">
                  <dt className="text-fg-subtle w-24 shrink-0">Guests</dt>
                  <dd className="text-fg font-mono tabular-nums">{venue.capacity.toLocaleString("en-IN")}</dd>
                </div>
                {category ? (
                  <div className="flex gap-3">
                    <dt className="text-fg-subtle w-24 shrink-0">Type</dt>
                    <dd className="text-fg">{category}</dd>
                  </div>
                ) : null}
                <div className="flex gap-3">
                  <dt className="text-fg-subtle w-24 shrink-0">Price</dt>
                  <dd className="text-fg">{venue.perHead !== null ? <span className="font-mono tabular-nums">From {inr(venue.perHead)} / guest</span> : "On request"}</dd>
                </div>
                {venue.minSpend > 0 ? (
                  <div className="flex gap-3">
                    <dt className="text-fg-subtle w-24 shrink-0">Min spend</dt>
                    <dd className="text-fg font-mono tabular-nums">{inr(venue.minSpend)}</dd>
                  </div>
                ) : null}
                {venue.policy && "reason" in venue.policy ? (
                  <div className="flex gap-3">
                    <dt className="text-fg-subtle w-24 shrink-0">Policy</dt>
                    <dd className="text-fg">Needs approval: {venue.policy.reason}.</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
          <footer className="border-line flex items-center justify-between gap-2 border-t px-5 py-3">
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn btn-ghost h-8 gap-1.5 px-2.5 text-caption">
              <MapPin className="size-3.5" aria-hidden /> Open in Maps
            </a>
            <QuoteRequestButton venue={{ id: venue.id, name: venue.name }} className="btn-primary" />
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
