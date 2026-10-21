"use client";

import { VenueMap, type MapVenue } from "@/components/portal/venue-map";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { OfficeLocation } from "@/lib/venues/discovery";

/**
 * The /venues directory's Map view: every matching venue with coordinates
 * (Lufer.ai's own; partner feeds have none). A pin opens the venue in the
 * inspector, like a table row; the open venue's pin is highlighted.
 */
export function VenueMapView({ venues, office, className }: { venues: MapVenue[]; office: OfficeLocation | null; className?: string }) {
  const { state, inspect } = useWorkspace();
  const selectedId = state.inspecting?.kind === "venue" ? state.inspecting.id : null;
  return <VenueMap venues={venues} selectedId={selectedId} onSelect={(id) => inspect("venue", id)} office={office} className={className} />;
}
