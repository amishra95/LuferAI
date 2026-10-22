-- =============================================================================
-- PostGIS spatial venue search
-- -----------------------------------------------------------------------------
-- - venues.location: geography(Point, 4326) generated from latitude/longitude,
--   so it can never drift from the coordinates the map and partners edit.
-- - GiST index on it: ST_DWithin and the <-> KNN operator both use it.
-- - nearby_venues_within_radius(): active venues within radius_meters of a
--   point, nearest first, with the distance in metres. Feeds the /client
--   "1.8 km from HQ" badges (lib/actions/venue-search.ts).
-- =============================================================================

create extension if not exists postgis with schema extensions;

alter table public.venues
  add column if not exists location extensions.geography(Point, 4326)
    generated always as (
      case when latitude is not null and longitude is not null
        then extensions.st_setsrid(extensions.st_makepoint(longitude::float8, latitude::float8), 4326)::extensions.geography
      end
    ) stored;

create index if not exists idx_venues_location_gist on public.venues using gist (location);

create or replace function public.nearby_venues_within_radius(
  client_lat    float8,
  client_lng    float8,
  radius_meters float8,
  max_results   integer default 100
)
returns table (
  venue_id        uuid,
  name            text,
  neighborhood    text,
  city            text,
  latitude        float8,
  longitude       float8,
  distance_meters float8
)
language sql stable security invoker set search_path = public, extensions
as $$
  with origin as (
    select st_setsrid(st_makepoint(client_lng, client_lat), 4326)::geography as g
  )
  select v.id, v.name, v.neighborhood, v.city, v.latitude::float8, v.longitude::float8,
         st_distance(v.location, origin.g) as distance_meters
  from public.venues v, origin
  where v.is_active
    and v.location is not null
    -- Capped at 200 km: this is "near the office", not a national search.
    and st_dwithin(v.location, origin.g, least(greatest(radius_meters, 0), 200000))
  order by v.location <-> origin.g
  limit least(greatest(max_results, 1), 500);
$$;

revoke all on function public.nearby_venues_within_radius(float8, float8, float8, integer) from public, anon;
grant execute on function public.nearby_venues_within_radius(float8, float8, float8, integer) to authenticated, service_role;
