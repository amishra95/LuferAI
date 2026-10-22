"use server";

import { Redis } from "@upstash/redis";

import { requirePortal } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CacheSource } from "@/lib/cache/spatial-cache";
import { parseSpatialQuery, searchNearbyVenues, type NearbyVenue } from "@/lib/venues/spatial";

/** Without UPSTASH_REDIS_REST_URL / _TOKEN every query goes to the database. */
const cache = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

/**
 * Active venues within radiusMeters of a point, nearest first, with PostGIS
 * distances. null when spatial search isn't available (local data store, or
 * the PostGIS migration not yet applied): callers fall back to client-side
 * distances (lib/venues/discovery.ts).
 */
export async function searchVenuesSpatial(input: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}): Promise<{ venues: NearbyVenue[]; source: CacheSource } | null> {
  await requirePortal("/client");
  const query = parseSpatialQuery(input);
  if (dataSource() !== "supabase") return null;
  try {
    return await searchNearbyVenues({ db: createAdminClient(), cache }, query);
  } catch (err) {
    console.error("Spatial venue search unavailable; using client-side distances", err);
    return null;
  }
}
