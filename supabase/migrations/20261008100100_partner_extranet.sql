-- Partner extranet, part 2 ----------------------------------------------------------------
-- External venue suppliers manage their own listings and rate cards at /partner.
--
-- 1. partners: supplier organisations.
-- 2. Partner memberships on platform_users: role PARTNER + partner_id + partner_role
--    (OWNER / MANAGER / STAFF — see lib/auth/partner-rbac.ts).
-- 3. partner_venues and partner_rate_cards: the listings the venue directory and the
--    concierge's searchVenues tool show as tier "partner".
-- 4. partner_audit_log: who changed what.
-- 5. RLS mirroring the role grants. The app writes through the service role after
--    its own checks; these policies are the backstop for direct API access.

-- 1 · Partners -------------------------------------------------------------------------------
create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  contact_email text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status        text not null default 'active' check (status in ('active', 'suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists partners_set_updated_at on public.partners;
create trigger partners_set_updated_at
  before update on public.partners
  for each row execute function public.set_updated_at();

-- 2 · Memberships ----------------------------------------------------------------------------
do $$ begin
  create type public.partner_role as enum ('OWNER', 'MANAGER', 'STAFF');
exception when duplicate_object then null; end $$;

alter table public.platform_users
  add column if not exists partner_id   uuid references public.partners (id) on delete cascade,
  add column if not exists partner_role public.partner_role;

create index if not exists platform_users_partner_idx on public.platform_users (partner_id) where partner_id is not null;

-- Each role is scoped to exactly one kind of organisation.
alter table public.platform_users drop constraint if exists platform_users_scope_check;
alter table public.platform_users add constraint platform_users_scope_check check (
  (role = 'ADMIN'    and company_id is null     and venue_id is null     and partner_id is null) or
  (role = 'CLIENT'   and company_id is not null and venue_id is null     and partner_id is null) or
  (role = 'PROPERTY' and venue_id   is not null and company_id is null   and partner_id is null) or
  (role = 'PARTNER'  and partner_id is not null and company_id is null   and venue_id is null)
);
alter table public.platform_users drop constraint if exists platform_users_partner_role_check;
alter table public.platform_users add constraint platform_users_partner_role_check
  check ((role = 'PARTNER') = (partner_role is not null));

create or replace function public.current_partner_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select partner_id from public.platform_users where user_id = auth.uid() $$;

create or replace function public.current_partner_role()
returns public.partner_role
language sql stable security definer set search_path = public
as $$ select partner_role from public.platform_users where user_id = auth.uid() $$;

-- 3 · Listings and rate cards ---------------------------------------------------------------
create table if not exists public.partner_venues (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references public.partners (id) on delete cascade,
  ref            text not null check (ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  area           text not null check (char_length(btrim(area)) between 2 and 80),
  city           text not null default 'Bengaluru' check (char_length(btrim(city)) between 2 and 80),
  address        text not null default '' check (char_length(address) <= 200),
  capacity       integer not null check (capacity between 1 and 5000),
  min_spend_inr  numeric(14,2) not null default 0 check (min_spend_inr >= 0),
  private_dining boolean not null default false,
  status         text not null default 'active' check (status in ('active', 'paused')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (partner_id, ref),
  -- Target for the rate cards' composite key (a card can't point at another partner's listing).
  unique (id, partner_id)
);

drop trigger if exists partner_venues_set_updated_at on public.partner_venues;
create trigger partner_venues_set_updated_at
  before update on public.partner_venues
  for each row execute function public.set_updated_at();

create table if not exists public.partner_rate_cards (
  id               uuid primary key default gen_random_uuid(),
  partner_id       uuid not null references public.partners (id) on delete cascade,
  partner_venue_id uuid not null,
  label            text not null check (char_length(btrim(label)) between 2 and 80),
  per_head_inr     numeric(12,2) not null check (per_head_inr > 0),
  -- Smallest group this rate applies to; larger brackets may carry their own rate.
  min_guests       integer not null default 1 check (min_guests between 1 and 5000),
  valid_from       date not null,
  valid_to         date,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  foreign key (partner_venue_id, partner_id) references public.partner_venues (id, partner_id) on delete cascade
);

create index if not exists partner_rate_cards_venue_idx on public.partner_rate_cards (partner_venue_id, valid_from);

drop trigger if exists partner_rate_cards_set_updated_at on public.partner_rate_cards;
create trigger partner_rate_cards_set_updated_at
  before update on public.partner_rate_cards
  for each row execute function public.set_updated_at();

-- No two rates for the same listing and guest bracket on the same day (the app checks first
-- with friendlier errors; this closes the race).
create extension if not exists btree_gist;
alter table public.partner_rate_cards drop constraint if exists partner_rate_cards_no_overlap;
alter table public.partner_rate_cards add constraint partner_rate_cards_no_overlap
  exclude using gist (
    partner_venue_id with =,
    min_guests with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  );

-- 4 · Audit log ------------------------------------------------------------------------------
create table if not exists public.partner_audit_log (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null check (char_length(action) between 3 and 64),
  entity     text not null check (entity in ('listing', 'rate_card', 'member', 'partner')),
  entity_id  uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists partner_audit_log_partner_idx on public.partner_audit_log (partner_id, created_at desc);

-- 5 · Row Level Security ---------------------------------------------------------------------
alter table public.partners           enable row level security;
alter table public.partner_venues     enable row level security;
alter table public.partner_rate_cards enable row level security;
alter table public.partner_audit_log  enable row level security;

create policy "admins manage partners"
  on public.partners for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "partner users read own partner"
  on public.partners for select to authenticated
  using (id = public.current_partner_id());

create policy "admins manage partner venues"
  on public.partner_venues for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "partner users read own venues"
  on public.partner_venues for select to authenticated
  using (partner_id = public.current_partner_id());
create policy "partner editors insert own venues"
  on public.partner_venues for insert to authenticated
  with check (partner_id = public.current_partner_id() and public.current_partner_role() in ('OWNER', 'MANAGER'));
create policy "partner users update own venues"
  on public.partner_venues for update to authenticated
  using (partner_id = public.current_partner_id())
  with check (partner_id = public.current_partner_id());
create policy "partner editors delete own venues"
  on public.partner_venues for delete to authenticated
  using (partner_id = public.current_partner_id() and public.current_partner_role() in ('OWNER', 'MANAGER'));

-- Staff may update a listing, but only its status (pause / resume).
create or replace function public.partner_venues_staff_status_only()
returns trigger
language plpgsql
as $$
begin
  if public.current_partner_role() = 'STAFF'
     and (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'Staff can only pause or resume a listing';
  end if;
  return new;
end;
$$;

drop trigger if exists partner_venues_staff_status_only on public.partner_venues;
create trigger partner_venues_staff_status_only
  before update on public.partner_venues
  for each row execute function public.partner_venues_staff_status_only();

create policy "admins manage partner rate cards"
  on public.partner_rate_cards for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "partner users read own rate cards"
  on public.partner_rate_cards for select to authenticated
  using (partner_id = public.current_partner_id());
create policy "partner editors manage own rate cards"
  on public.partner_rate_cards for all to authenticated
  using (partner_id = public.current_partner_id() and public.current_partner_role() in ('OWNER', 'MANAGER'))
  with check (partner_id = public.current_partner_id() and public.current_partner_role() in ('OWNER', 'MANAGER'));

create policy "admins read partner audit log"
  on public.partner_audit_log for select to authenticated
  using (public.is_platform_admin());
create policy "partner owners and managers read own audit log"
  on public.partner_audit_log for select to authenticated
  using (partner_id = public.current_partner_id() and public.current_partner_role() in ('OWNER', 'MANAGER'));
