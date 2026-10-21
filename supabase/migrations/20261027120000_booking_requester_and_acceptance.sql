-- =============================================================================
-- Who requested a booking, and when its venue accepted it.
--
-- requested_by: the employee who filed the request (placeBookingRequest), so the
--   venue's acceptance can be sent to them. Null for bookings made before this
--   migration and for ones whose requester's account is deleted.
-- venue_accepted_at: set by trigger the first time a booking becomes CONFIRMED,
--   whichever path confirms it (the venue in its portal, the booking agent on
--   pre-agreed terms, a countersigned contract).
-- =============================================================================

alter table public.bookings
  add column if not exists requested_by uuid references auth.users (id) on delete set null,
  add column if not exists venue_accepted_at timestamptz;

create index if not exists bookings_requested_by_idx on public.bookings (requested_by) where requested_by is not null;

create or replace function public.bookings_stamp_venue_accepted()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'CONFIRMED' and old.status is distinct from 'CONFIRMED' and new.venue_accepted_at is null then
    new.venue_accepted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_stamp_venue_accepted on public.bookings;
create trigger bookings_stamp_venue_accepted
  before update of status on public.bookings
  for each row execute function public.bookings_stamp_venue_accepted();
