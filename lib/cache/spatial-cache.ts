/**
 * Read-through cache for spatial venue queries whose origin sits in a key
 * business hub, where most company offices are and the same HQ coordinates
 * are asked for again and again. Pure wiring: takes any client with get/set,
 * so tests can pass a fake (tests/venue-spatial-search.test.mjs).
 *
 * Redis is an accelerator, never a dependency: a cache read or write that
 * fails is logged and the query goes to the database.
 */
import { distanceKm, type LatLng } from "../venues/discovery.ts";

/** Minimal client surface (structurally matches @upstash/redis Redis). */
export interface CacheLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts: { ex: number }): Promise<unknown>;
}

export const SPATIAL_CACHE_TTL_SECONDS = 300;

/** Queries starting within this distance of a hub's centre are cached. */
export const HUB_CATCHMENT_KM = 5;

export const BUSINESS_HUBS: readonly ({ name: string } & LatLng)[] = [
  { name: "BKC", latitude: 19.0657, longitude: 72.8686 },
  { name: "Indiranagar", latitude: 12.9719, longitude: 77.6412 },
  { name: "Whitefield", latitude: 12.9698, longitude: 77.75 },
  { name: "Hitec City", latitude: 17.4435, longitude: 78.3772 },
];

/** The hub whose catchment contains the point, or null. */
export function hubFor(point: LatLng): string | null {
  return BUSINESS_HUBS.find((h) => distanceKm(h, point) <= HUB_CATCHMENT_KM)?.name ?? null;
}

/**
 * Coordinates rounded to 5 decimals (~1 m), so the same office always maps to
 * the same key.
 */
export function spatialCacheKey(point: LatLng, radiusMeters: number): string {
  return `spatial:venues:${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}:${Math.round(radiusMeters)}`;
}

export type CacheSource = "cache" | "db";

/**
 * load() through the cache when the origin is in a hub and a cache is
 * configured; straight to load() otherwise.
 */
export async function cachedSpatialQuery<T>(
  cache: CacheLike | null,
  point: LatLng,
  radiusMeters: number,
  load: () => Promise<T>
): Promise<{ value: T; source: CacheSource }> {
  if (!cache || !hubFor(point)) return { value: await load(), source: "db" };

  const key = spatialCacheKey(point, radiusMeters);
  try {
    const hit = await cache.get<T>(key);
    if (hit != null) return { value: hit, source: "cache" };
  } catch (err) {
    console.error("Spatial cache read failed; querying the database", err);
  }

  const value = await load();
  try {
    await cache.set(key, value, { ex: SPATIAL_CACHE_TTL_SECONDS });
  } catch (err) {
    console.error("Spatial cache write failed", err);
  }
  return { value, source: "db" };
}
