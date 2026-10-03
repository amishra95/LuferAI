-- =============================================================================
-- 0004 · Portal isolation: platform_users + Row Level Security
-- -----------------------------------------------------------------------------
-- Each authenticated user belongs to exactly one portal:
--   ADMIN    → sees everything
--   CLIENT   → sees only their company's rows
--   PROPERTY → sees only their venue's rows
-- The service-role key bypasses RLS (used server-side until auth UI exists).
-- =============================================================================

do $$ begin
  create type public.portal_role as enum ('ADMIN', 'CLIENT', 'PROPERTY');
exception when duplicate_object then null; end $$;

create table if not exists public.platform_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        public.portal_role not null,
  company_id  uuid references public.companies (id) on delete cascade,
  venue_id    uuid references public.venues (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint platform_users_scope_check check (
    (role = 'ADMIN'    and company_id is null     and venue_id is null) or
    (role = 'CLIENT'   and company_id is not null and venue_id is null) or
    (role = 'PROPERTY' and venue_id   is not null and company_id is null)
  )
);

-- Helper functions (SECURITY DEFINER so policies can read platform_users) ------------
create or replace function public.current_portal_role()
returns public.portal_role
language sql stable security definer set search_path = public
as $$ select role from public.platform_users where user_id = auth.uid() $$;

create or replace function public.current_company_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select company_id from public.platform_users where user_id = auth.uid() $$;

create or replace function public.current_venue_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select venue_id from public.platform_users where user_id = auth.uid() $$;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_portal_role() = 'ADMIN', false) $$;

-- Enable RLS -----------------------------------------------------------------------
alter table public.platform_users            enable row level security;
alter table public.companies                 enable row level security;
alter table public.venues                    enable row level security;
alter table public.bookings                  enable row level security;
alter table public.venue_onboarding_requests enable row level security;
alter table public.gst_state_codes           enable row level security;

-- gst_state_codes: public reference data
create policy "state codes readable by everyone"
  on public.gst_state_codes for select
  to anon, authenticated
  using (true);

-- platform_users
create policy "users read own membership"
  on public.platform_users for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

create policy "admins manage memberships"
  on public.platform_users for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- companies
create policy "admins manage companies"
  on public.companies for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "clients read own company"
  on public.companies for select to authenticated
  using (id = public.current_company_id());

create policy "venues read companies they serve"
  on public.companies for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.company_id = companies.id and b.venue_id = public.current_venue_id()
  ));

-- venues: any signed-in user can browse active venues (clients need the catalogue)
create policy "authenticated read active venues"
  on public.venues for select to authenticated
  using (is_active or public.is_platform_admin() or id = public.current_venue_id());

create policy "admins manage venues"
  on public.venues for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "property updates own venue"
  on public.venues for update to authenticated
  using (id = public.current_venue_id()) with check (id = public.current_venue_id());

-- bookings
create policy "admins manage bookings"
  on public.bookings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "clients read own bookings"
  on public.bookings for select to authenticated
  using (company_id = public.current_company_id());

create policy "clients create pending bookings"
  on public.bookings for insert to authenticated
  with check (company_id = public.current_company_id() and status = 'PENDING');

create policy "clients cancel own bookings"
  on public.bookings for update to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id() and status = 'CANCELLED');

create policy "property reads own bookings"
  on public.bookings for select to authenticated
  using (venue_id = public.current_venue_id());

create policy "property updates own bookings"
  on public.bookings for update to authenticated
  using (venue_id = public.current_venue_id())
  with check (venue_id = public.current_venue_id());

-- venue_onboarding_requests: anyone may apply, only admins review
create policy "anyone submits onboarding request"
  on public.venue_onboarding_requests for insert to anon, authenticated
  with check (status = 'SUBMITTED' and venue_id is null);

create policy "admins manage onboarding requests"
  on public.venue_onboarding_requests for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
