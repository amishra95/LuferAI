import type { Metadata } from "next";

import { PortalShell } from "@/components/portal/portal-shell";
import { requirePortal } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { venuePhotoUrls } from "@/lib/venues/photo-store";
import { PhotoCard } from "./photo-card";

export const metadata: Metadata = { title: "Venue photos" };

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
  const missing = rows.filter((r) => r.photos.length === 0).length;
  return (
    <section className="grid gap-4">
      <h2 className="text-fg text-body font-medium">
        {title} <span className="text-fg-subtle font-normal">{missing > 0 ? `${missing} of ${rows.length} without photos` : rows.length}</span>
      </h2>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {rows.map((r) => (
          <PhotoCard key={r.key} id={r.key} name={r.name} meta={r.meta} photos={r.photos.flatMap((ref) => venuePhotoUrls([ref]).map((url) => ({ ref, url })))} />
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
