-- =============================================================================
-- 0010 · Inventory holds + corporate rate cards
-- -----------------------------------------------------------------------------
-- inventory_holds
--   A hold reserves a venue for its booking's event date while the booking is
--   being approved/confirmed. hold_start → hold_expires_at is the hold's own
--   lifetime (default 24h), not the event. A date is locked by an ACTIVE hold
--   that hasn't expired; expiry is time-based, so no job is needed to free it.
--   Overlapping active holds on one venue/date are rejected by trigger under an
--   advisory lock, so two tenants can't grab the same date concurrently.
--   Holds follow their booking: CONFIRMED converts the live hold, CANCELLED
--   releases it (trigger on bookings), whichever path changed the booking.
--
-- corporate_rate_cards
--   Negotiated terms between a tenant (company) and a venue for a date range.
--   Only platform admins write them; the tenant and the venue can read theirs.
--   Ranges for the same tenant + venue can't overlap, so at most one card
--   applies on any date.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

do $$ begin
  create type public.hold_status as enum ('ACTIVE', 'RELEASED', 'CONVERTED');
exception when duplicate_object then null; end $$;

-- Lets holds prove their booking really is that tenant's booking at that venue.
alter table public.bookings
  add constraint bookings_id_company_id_venue_id_key unique (id, company_id, venue_id);

-- inventory_holds ----------------------------------------------------------------------
create table if not exists public.inventory_holds (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues (id) on delete cascade,
  tenant_id        uuid not null references public.companies (id) on delete cascade,
  booking_id       uuid not null references public.bookings (id) on delete cascade,
  hold_start       timestamptz not null default now(),
  -- Defaults to hold_start + 24h (trigger: a column default can't read hold_start).
  hold_expires_at  timestamptz not null,
  status           public.hold_status not null default 'ACTIVE',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint inventory_holds_booking_consistency_fkey
    foreign key (booking_id, tenant_id, venue_id)
    references public.bookings (id, company_id, venue_id) on delete cascade,
  constraint inventory_holds_window_check check (hold_expires_at > hold_start)
);

comment on table  public.inventory_holds is
  'Temporary lock on a venue for a booking''s event date. Locks only while ACTIVE and before hold_expires_at.';
comment on column public.inventory_holds.hold_expires_at is 'Defaults to hold_start + 24 hours.';

create index if not exists inventory_holds_venue_id_idx  on public.inventory_holds (venue_id);
create index if not exists inventory_holds_tenant_id_idx on public.inventory_holds (tenant_id);
-- One live hold per booking.
create unique index if not exists inventory_holds_one_active_per_booking_idx
  on public.inventory_holds (booking_id) where status = 'ACTIVE';

create trigger inventory_holds_set_updated_at
  before update on public.inventory_holds
  for each row execute function public.set_updated_at();

-- Default expiry + no overlapping live holds on the same venue and event date.
-- SECURITY DEFINER: the conflict check must see other tenants' holds, which the
-- inserting user's RLS hides (otherwise every tenant would only check its own).
create or replace function public.inventory_holds_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_date date;
begin
  new.hold_start := coalesce(new.hold_start, now());
  new.hold_expires_at := coalesce(new.hold_expires_at, new.hold_start + interval '24 hours');

  select event_date into target_date from public.bookings where id = new.booking_id;

  -- Serialise holds per venue/date so concurrent inserts can't both pass the check.
  perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text || ':' || target_date::text, 0));

  if exists (
    select 1
    from public.inventory_holds h
    join public.bookings b on b.id = h.booking_id
    where h.venue_id = new.venue_id
      and b.event_date = target_date
      and h.status = 'ACTIVE'
      and h.hold_expires_at > now()
  ) then
    raise exception 'Venue % is already held for %', new.venue_id, target_date
      using errcode = '23P01';  -- exclusion_violation
  end if;

  return new;
end;
$$;

create trigger inventory_holds_before_insert
  before insert on public.inventory_holds
  for each row execute function public.inventory_holds_before_insert();

-- ACTIVE → RELEASED | CONVERTED, then final. CONVERTED requires the booking to be
-- CONFIRMED (for everyone). Portal users may change nothing but the status.
create or replace function public.inventory_holds_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'ACTIVE' then
      raise exception 'Hold % is % and cannot move to %', old.id, old.status, new.status;
    end if;
    if new.status = 'CONVERTED' and not exists (
      select 1 from public.bookings where id = new.booking_id and status = 'CONFIRMED'
    ) then
      raise exception 'Hold % can only be converted once its booking is CONFIRMED', old.id;
    end if;
  end if;

  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;

  if (new.id, new.venue_id, new.tenant_id, new.booking_id, new.hold_start, new.hold_expires_at, new.created_at)
     is distinct from
     (old.id, old.venue_id, old.tenant_id, old.booking_id, old.hold_start, old.hold_expires_at, old.created_at)
  then
    raise exception 'Only a hold''s status can be changed from a portal' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger inventory_holds_guard_update
  before update on public.inventory_holds
  for each row execute function public.inventory_holds_guard_update();

-- Holds follow their booking -----------------------------------------------------------
-- SECURITY DEFINER: the user moving the booking (e.g. a venue confirming it) may
-- have no RLS write access to the tenant's hold.
create or replace function public.bookings_sync_inventory_holds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'CONFIRMED' then
    update public.inventory_holds set status = 'CONVERTED'
    where booking_id = new.id and status = 'ACTIVE';
  elsif new.status = 'CANCELLED' then
    update public.inventory_holds set status = 'RELEASED'
    where booking_id = new.id and status = 'ACTIVE';
  end if;
  return null;
end;
$$;

create trigger bookings_sync_inventory_holds
  after update of status on public.bookings
  for each row
  when (old.status is distinct from new.status and new.status in ('CONFIRMED', 'CANCELLED'))
  execute function public.bookings_sync_inventory_holds();

-- corporate_rate_cards -------------------------------------------------------------------
create table if not exists public.corporate_rate_cards (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.companies (id) on delete cascade,
  venue_id                uuid not null references public.venues (id) on delete cascade,
  discount_percentage     numeric(5,2) not null default 0
                            check (discount_percentage >= 0 and discount_percentage <= 100),
  -- Replaces the per-head price outright (the discount then doesn't apply).
  custom_per_head_rate    numeric(14,2) check (custom_per_head_rate >= 0),
  minimum_spend_override  numeric(14,2) check (minimum_spend_override >= 0),
  effective_from          date not null,
  effective_to            date,  -- null = open-ended
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint corporate_rate_cards_range_check check (effective_to is null or effective_to >= effective_from),
  constraint corporate_rate_cards_no_overlap exclude using gist (
    tenant_id with =,
    venue_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

comment on table  public.corporate_rate_cards is
  'Negotiated tenant × venue terms for a date range (inclusive). Ranges never overlap per tenant + venue.';
comment on column public.corporate_rate_cards.discount_percentage is 'Percent off the per-head price, e.g. 15.00 = 15%.';
comment on column public.corporate_rate_cards.custom_per_head_rate is 'Fixed per-head price (INR, pre-GST); overrides discount_percentage.';
comment on column public.corporate_rate_cards.minimum_spend_override is 'Replaces the venue''s min_spend_inr for this tenant.';

create index if not exists corporate_rate_cards_venue_id_idx on public.corporate_rate_cards (venue_id);

create trigger corporate_rate_cards_set_updated_at
  before update on public.corporate_rate_cards
  for each row execute function public.set_updated_at();

-- Row Level Security -----------------------------------------------------------------------
alter table public.inventory_holds      enable row level security;
alter table public.corporate_rate_cards enable row level security;

-- inventory_holds
create policy "admins manage inventory holds"
  on public.inventory_holds for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "tenant users read own holds"
  on public.inventory_holds for select to authenticated
  using (tenant_id = public.current_company_id());

create policy "tenant users place holds"
  on public.inventory_holds for insert to authenticated
  with check (tenant_id = public.current_company_id() and status = 'ACTIVE');

create policy "tenant users update own holds"
  on public.inventory_holds for update to authenticated
  using (tenant_id = public.current_company_id())
  with check (tenant_id = public.current_company_id());

-- Venues see holds on their own dates (to know what's locked), not other venues'.
create policy "property reads holds on own venue"
  on public.inventory_holds for select to authenticated
  using (venue_id = public.current_venue_id());

-- corporate_rate_cards: platform-negotiated, so read-only for both parties
create policy "admins manage rate cards"
  on public.corporate_rate_cards for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "tenant users read own rate cards"
  on public.corporate_rate_cards for select to authenticated
  using (tenant_id = public.current_company_id());

create policy "property reads rate cards for own venue"
  on public.corporate_rate_cards for select to authenticated
  using (venue_id = public.current_venue_id());
