-- =============================================================================
-- Company office location (client venue discovery)
-- -----------------------------------------------------------------------------
-- - companies.office_latitude/office_longitude: where the team works, for the
--   "1.8 km from HQ" badges on venue cards and the office pin on the venue map.
-- - companies.office_label: what the badge calls it ("HQ", "Indiranagar office").
-- Both coordinates or neither; null = no badges.
-- =============================================================================

alter table public.companies
  add column if not exists office_latitude  numeric(9,6) check (office_latitude between -90 and 90),
  add column if not exists office_longitude numeric(9,6) check (office_longitude between -180 and 180),
  add column if not exists office_label     text not null default 'office' check (length(trim(office_label)) > 0);

alter table public.companies
  add constraint companies_office_coordinates_paired
    check ((office_latitude is null) = (office_longitude is null));

comment on column public.companies.office_label is 'Short name for the office in distance badges, e.g. "HQ".';
