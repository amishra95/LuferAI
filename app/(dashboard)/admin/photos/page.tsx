import type { Metadata } from "next";

import { PortalShell } from "@/components/portal/portal-shell";
import { VenuePhoto } from "@/components/venues/venue-photo";
import { requirePortal } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { venuePhotoUrls } from "@/lib/venues/photo-store";
import { MAX_PHOTOS } from "@/lib/venues/photos";
import { PhotoManager, type PhotoActions } from "../../property/_components/photo-manager";
import { attachAdminPhotoAction, startAdminPhotoUploadAction, updateAdminPhotoAction } from "./actions";

export const metadata: Metadata = { title: "Venue photos" };

const ACTIONS: PhotoActions = { start: startAdminPhotoUploadAction, attach: attachAdminPhotoAction, update: updateAdminPhotoAction };

interface Row {
  key: string;
  name: string;
  meta: string;
  photos: string[];
}

async function load(): Promise<{ listings: Row[]; venues: Row[] }> {
  if (dataSource() !== "supabase") return { listings: [], venues: [] };
  const db = createAdminClient();
  const [{ data: listings, error }, { data: venues, error: venuesError }] = await Promise.all([
    db.from("partner_venues").select("id, ref, name, area, status, photos, partner:partners!inner(name)").order("ref"),
    db.from("venues").select("id, name, neighborhood, city, photos").order("name"),
  ]);
  if (error) throw error;
  if (venuesError) throw venuesError;
  return {
    listings: listings.map((l) => ({
      key: `listing:${l.id}`,
      name: l.name,
      meta: [l.ref, l.area, (l.partner as { name: string }).name, l.status === "paused" ? "Paused" : null].filter(Boolean).join(" · "),
      photos: l.photos ?? [],
    })),
    venues: venues.map((v) => ({ key: `venue:${v.id}`, name: v.name, meta: [v.neighborhood, v.city].filter(Boolean).join(", "), photos: v.photos ?? [] })),
  };
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="grid gap-3">
      <h2 className="text-fg text-body font-medium">
        {title} <span className="text-fg-subtle font-normal">{rows.length}</span>
      </h2>
      <ul className="border-line divide-line divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={r.key}>
            <details className="group">
              <summary className="hover:bg-surface flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                <VenuePhoto url={venuePhotoUrls(r.photos)[0]} className="size-10 shrink-0 rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-body">{r.name}</span>
                  <span className="text-fg-subtle block truncate text-meta">{r.meta}</span>
                </span>
                <span className="text-fg-subtle text-meta tabular-nums">
                  {r.photos.length}/{MAX_PHOTOS}
                </span>
              </summary>
              <div className="px-4 pt-1 pb-4">
                <PhotoManager
                  venueId={r.key}
                  venueName={r.name}
                  photos={r.photos.flatMap((ref) => venuePhotoUrls([ref]).map((url) => ({ ref, url })))}
                  actions={ACTIONS}
                />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Photos for every venue and partner listing, for Lufer admins. */
export default async function VenuePhotosPage() {
  await requirePortal("/admin");
  const { listings, venues } = await load();
  return (
    <PortalShell portal="/admin" title="Venue photos">
      <div className="grid gap-8">
        <Section title="Concierge listings" rows={listings} />
        <Section title="Venues" rows={venues} />
        {listings.length + venues.length === 0 ? <p className="text-fg-subtle text-body">No venues yet.</p> : null}
      </div>
    </PortalShell>
  );
}
