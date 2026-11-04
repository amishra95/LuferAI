-- =============================================================================
-- A venue can sign up without its GSTIN, and adds it before it's listed
-- -----------------------------------------------------------------------------
-- Bookings, tax invoices, contracts and the client's input tax credit all run
-- on the venue's GSTIN, so a listed venue must have one. An unlisted venue that
-- has just signed up may not have it to hand: it adds it from its welcome
-- checklist (server code, service role), and an admin publishes it after.
-- =============================================================================

alter table public.venues alter column gstin drop not null;

alter table public.venues drop constraint if exists venues_listed_have_gstin;
alter table public.venues add constraint venues_listed_have_gstin check (not is_active or gstin is not null);

-- The application no longer needs a GSTIN for a venue; the rest still applies.
alter table public.signup_applications drop constraint if exists signup_applications_venue_details;
alter table public.signup_applications add constraint signup_applications_venue_details check (
  account_type <> 'venue'
  or (city is not null and venue_area is not null and venue_address is not null and venue_capacity is not null)
);
