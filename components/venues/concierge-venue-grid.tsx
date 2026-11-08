import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { QuoteRequestButton } from "@/components/venues/quote-request-button";
import { VenuePhoto } from "@/components/venues/venue-photo";
import type { DirectoryVenue } from "@/lib/venues/directory";

const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L` : `₹${Math.round(n / 1000)}k`);

/** Listings kept in Lufer (partner_venues), quoted through the concierge: "Request a quote" can name them. */
export const conciergeListings = (venues: readonly DirectoryVenue[]) => venues.filter((v) => v.tier === "partner" && v.id.startsWith("extranet:"));

/**
 * Venue cards that ask Lufer's concierge for a quote (/venues, and Home while
 * nothing is bookable directly). With `limit`, the first few and a link to all.
 */
export function ConciergeVenueGrid({
  venues,
  heading,
  limit,
  moreHref,
  className,
}: {
  venues: readonly DirectoryVenue[];
  /** Visible heading; null keeps it for screen readers only. */
  heading: string | null;
  limit?: number;
  moreHref?: string;
  className?: string;
}) {
  const shown = limit ? venues.slice(0, limit) : venues;
  return (
    <section aria-labelledby="partner-venues-heading" className={className}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="partner-venues-heading" className={heading === null ? "sr-only" : "text-fg text-body font-semibold tracking-tight"}>
          {heading ?? "Request a quote"}
        </h2>
        {moreHref && venues.length > shown.length ? (
          <Link href={moreHref} className="text-fg-subtle hover:text-fg inline-flex items-center gap-1 text-meta">
            All {venues.length} venues <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((v) => (
          <li key={v.id} className="panel flex flex-col gap-2 p-5">
            {/* No placeholder: a wall of empty photo boxes reads as unfinished. */}
            {v.photo_url ? <VenuePhoto url={v.photo_url} className="aspect-[16/9] w-full rounded-md" /> : null}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-fg truncate text-body font-medium">{v.name}</p>
                <p className="text-fg-subtle truncate text-caption">
                  {v.neighborhood} · {v.city}
                </p>
              </div>
              {v.min_spend_inr > 0 ? (
                <span className="text-fg shrink-0 font-mono text-meta tabular-nums" title="Minimum spend">
                  {compact(v.min_spend_inr)} min
                </span>
              ) : null}
            </div>
            <p className="text-fg-subtle text-caption">
              Up to {v.capacity_max} guests{v.pdr_available ? " · private room" : ""}
            </p>
            <QuoteRequestButton venue={{ id: v.id.replace(/^extranet:/, ""), name: v.name }} className="mt-auto self-start" />
          </li>
        ))}
      </ul>
    </section>
  );
}
