-- Partner listings on the venue map.
--
-- - partner_venues.latitude/longitude: optional, set by the partner in the
--   /partner extranet. Both or neither, so a listing is either pinned or listed
--   as "no location" on /venues?view=map. Same precision as venues.latitude.

alter table public.partner_venues
  add column if not exists latitude  numeric(9,6) check (latitude between -90 and 90),
  add column if not exists longitude numeric(9,6) check (longitude between -180 and 180);

alter table public.partner_venues
  add constraint partner_venues_coordinates_paired
    check ((latitude is null) = (longitude is null));
