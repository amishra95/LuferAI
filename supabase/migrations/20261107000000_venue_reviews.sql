-- =============================================================================
-- Venue reviews: what the company thought of the event
-- -----------------------------------------------------------------------------
-- One review per booking, 1–5 stars and an optional comment, left by someone
-- at the booking's company once the event has happened (COMPLETED or SETTLED).
-- Venue cards show the average once a venue has enough reviews
-- (lib/venues/reviews.ts); the venue reads its own reviews in /property.
--
-- venue_id and company_id are copied from the booking by trigger, so a review
-- can't be filed against another venue. Writes go through the service role
-- only (the client portal's server action checks the author's company).
-- Reviewers' companies, venues and admins read; other companies see only the
-- averages the server publishes.
-- =============================================================================

create table if not exists public.venue_reviews (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null unique references public.bookings (id) on delete cascade,
  venue_id    uuid not null references public.venues (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.venue_reviews is
  'One review per completed booking: 1–5 stars and an optional comment from the booking''s company. Service role writes only.';

create index if not exists venue_reviews_venue_idx on public.venue_reviews (venue_id, created_at desc);

create or replace function public.venue_reviews_from_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  b record;
begin
  select venue_id, company_id, status into b from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'booking % not found', new.booking_id;
  end if;
  if b.status::text not in ('COMPLETED', 'SETTLED') then
    raise exception 'only completed events can be reviewed (booking is %)', b.status;
  end if;
  new.venue_id := b.venue_id;
  new.company_id := b.company_id;
  return new;
end;
$$;

drop trigger if exists venue_reviews_from_booking on public.venue_reviews;
create trigger venue_reviews_from_booking
  before insert or update of booking_id, venue_id, company_id on public.venue_reviews
  for each row execute function public.venue_reviews_from_booking();

drop trigger if exists venue_reviews_set_updated_at on public.venue_reviews;
create trigger venue_reviews_set_updated_at
  before update on public.venue_reviews
  for each row execute function public.set_updated_at();

alter table public.venue_reviews enable row level security;
revoke all on public.venue_reviews from anon, authenticated;
grant select on public.venue_reviews to authenticated;

drop policy if exists "companies read their reviews" on public.venue_reviews;
create policy "companies read their reviews" on public.venue_reviews
  for select to authenticated
  using (company_id = (select public.current_company_id()));

drop policy if exists "venue managers read their reviews" on public.venue_reviews;
create policy "venue managers read their reviews" on public.venue_reviews
  for select to authenticated
  using (venue_id = (select public.current_venue_id()));

drop policy if exists "platform admins read reviews" on public.venue_reviews;
create policy "platform admins read reviews" on public.venue_reviews
  for select to authenticated
  using ((select public.is_platform_admin()));
