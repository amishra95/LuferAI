-- =============================================================================
-- The requester's mobile for a booking (E.164, e.g. +919845012345), captured
-- with the request (portal form, manual booking, or the WhatsApp sender) so
-- event updates can go out by SMS / WhatsApp. Optional: null when not given.
-- =============================================================================

alter table public.bookings
  add column if not exists requested_by_phone text
    constraint bookings_requested_by_phone_e164 check (requested_by_phone is null or requested_by_phone ~ '^\+[1-9][0-9]{7,14}$');
