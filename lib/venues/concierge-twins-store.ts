import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { CONCIERGE_PARTNER_SLUG, conciergeTwins } from "./concierge-twins";

/**
 * Pauses the concierge listing(s) for a venue that just went live, so
 * companies see the bookable venue once. Returns the names paused. Never throws:
 * a failure here mustn't undo the publish (the listing can be paused on /partner).
 */
export async function pauseConciergeTwins(venue: { name: string; neighborhood: string }): Promise<string[]> {
  try {
    const db = createAdminClient();
    const { data: partner } = await db.from("partners").select("id").eq("slug", CONCIERGE_PARTNER_SLUG).maybeSingle();
    if (!partner) return [];
    const { data: listings, error } = await db.from("partner_venues").select("id, name, area").eq("partner_id", partner.id).eq("status", "active");
    if (error) throw error;
    const twins = conciergeTwins(venue, listings);
    if (!twins.length) return [];
    const { error: pauseError } = await db.from("partner_venues").update({ status: "paused" }).in("id", twins.map((t) => t.id));
    if (pauseError) throw pauseError;
    return twins.map((t) => t.name);
  } catch (err) {
    console.error("concierge: could not pause listings for", venue.name, err);
    return [];
  }
}
