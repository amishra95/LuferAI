import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ConciergeVenueCard } from "@/components/venues/concierge-card";
import type { ConciergeCard } from "@/lib/venues/concierge-cards";

export { conciergeListings } from "@/lib/venues/concierge-cards";

/**
 * A few concierge venue cards and a link to all of them (Home, while nothing
 * is bookable directly). /venues uses ConciergeVenueExplorer, with filters.
 */
export function ConciergeVenueGrid({
  venues,
  heading,
  limit,
  moreHref,
  className,
}: {
  venues: readonly ConciergeCard[];
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
      <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((v) => (
          <ConciergeVenueCard key={v.id} venue={v} />
        ))}
      </ul>
    </section>
  );
}
