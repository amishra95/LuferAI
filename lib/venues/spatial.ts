/**
 * Spatial venue search over the nearby_venues_within_radius RPC (PostGIS,
 * migration …20261030120000). Kept free of server imports so
 * tests/venue-spatial-search.test.mjs can drive it with a fake RPC client.
 */
import { cachedSpatialQuery, type CacheLike, type CacheSource } from "../cache/spatial-cache.ts";
import type { LatLng } from "./discovery.ts";

export interface SpatialQuery extends LatLng {
  radiusMeters: number;
}

export interface NearbyVenue extends LatLng {
  id: string;
  name: string;
  neighborhood: string;
  city: string;
  distanceMeters: number;
}

/** The slice of a Supabase client this needs. */
export interface RpcClient {
  rpc(
    fn: "nearby_venues_within_radius",
    args: { client_lat: number; client_lng: number; radius_meters: number }
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

export const MAX_RADIUS_METERS = 200_000;

export class SpatialQueryError extends Error {}

/** Throws SpatialQueryError on coordinates or a radius the RPC would reject or clamp. */
export function parseSpatialQuery(input: { latitude: unknown; longitude: unknown; radiusMeters: unknown }): SpatialQuery {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const radiusMeters = Number(input.radiusMeters);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new SpatialQueryError("Latitude must be between -90 and 90.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new SpatialQueryError("Longitude must be between -180 and 180.");
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > MAX_RADIUS_METERS) {
    throw new SpatialQueryError(`Radius must be between 0 and ${MAX_RADIUS_METERS} metres.`);
  }
  return { latitude, longitude, radiusMeters };
}

type RpcRow = {
  venue_id: string;
  name: string;
  neighborhood: string;
  city: string;
  latitude: number | string;
  longitude: number | string;
  distance_meters: number | string;
};

/** Venues within the radius, nearest first, straight from PostGIS. */
export async function fetchNearbyVenues(db: RpcClient, q: SpatialQuery): Promise<NearbyVenue[]> {
  const { data, error } = await db.rpc("nearby_venues_within_radius", {
    client_lat: q.latitude,
    client_lng: q.longitude,
    radius_meters: q.radiusMeters,
  });
  if (error) throw new Error(`nearby_venues_within_radius failed: ${error.message}`);
  return ((data ?? []) as RpcRow[]).map((r) => ({
    id: r.venue_id,
    name: r.name,
    neighborhood: r.neighborhood,
    city: r.city,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    distanceMeters: Number(r.distance_meters),
  }));
}

/** fetchNearbyVenues through the hub cache (lib/cache/spatial-cache.ts). */
export async function searchNearbyVenues(
  deps: { db: RpcClient; cache: CacheLike | null },
  q: SpatialQuery
): Promise<{ venues: NearbyVenue[]; source: CacheSource }> {
  const { value, source } = await cachedSpatialQuery(deps.cache, q, q.radiusMeters, () => fetchNearbyVenues(deps.db, q));
  return { venues: value, source };
}
