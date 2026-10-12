-- =============================================================================
-- 0026 · Event plans and guest check-in
-- -----------------------------------------------------------------------------
-- event_plans      One per booking: the run of show (timed items), the catering
--                  package and special requirements, planned in the event
--                  workspace (/client/events/<id>). Every content change bumps
--                  `revision`; a client Approver signs off a revision
--                  (approved_revision) and the venue acknowledges an approved
--                  revision (venue_ack_revision). Rules: lib/events/plan.ts.
-- event_checkins   Guests marked as attended, on or after the event date.
--
-- Separate tables (not columns on event_workspaces / event_attendees) so the
-- app reads them as "not set up" until this migration is applied.
-- The app writes through the service role; the company reads its own rows, the
-- booked venue reads the plan, admins read all.
-- =============================================================================

create table if not exists public.event_plans (
  booking_id            uuid primary key,
  tenant_id             uuid not null references public.companies (id) on delete cascade,
  -- [{ "time": "HH:MM", "item": "..." }], sorted by time, at most 30.
  run_of_show           jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(run_of_show) = 'array' and jsonb_array_length(run_of_show) <= 30),
  catering_package_id   uuid references public.venue_menu_packages (id) on delete set null,
  special_requirements  text not null default '' check (char_length(special_requirements) <= 1000),
  revision              integer not null default 0 check (revision >= 0),
  approved_revision     integer check (approved_revision is null or approved_revision >= 0),
  approved_by           uuid references auth.users (id) on delete set null,
  approved_at           timestamptz,
  venue_ack_revision    integer check (venue_ack_revision is null or venue_ack_revision >= 0),
  venue_ack_by          uuid references auth.users (id) on delete set null,
  venue_ack_at          timestamptz,
  updated_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint event_plans_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade,
  -- Only the current or an earlier revision can be approved or acknowledged.
  constraint event_plans_approval_check check (approved_revision is null or approved_revision <= revision),
  constraint event_plans_ack_check check (venue_ack_revision is null or (approved_revision is not null and venue_ack_revision <= approved_revision))
);

drop trigger if exists event_plans_set_updated_at on public.event_plans;
create trigger event_plans_set_updated_at
  before update on public.event_plans
  for each row execute function public.set_updated_at();

create table if not exists public.event_checkins (
  attendee_id    uuid primary key references public.event_attendees (id) on delete cascade,
  booking_id     uuid not null,
  tenant_id      uuid not null references public.companies (id) on delete cascade,
  checked_in_by  uuid references auth.users (id) on delete set null,
  checked_in_at  timestamptz not null default now(),
  constraint event_checkins_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade
);

create index if not exists event_checkins_booking_idx on public.event_checkins (booking_id);

alter table public.event_plans    enable row level security;
alter table public.event_checkins enable row level security;

create policy "admins read event plans"
  on public.event_plans for select to authenticated
  using ((select public.is_platform_admin()));

create policy "tenants read own event plans"
  on public.event_plans for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "venues read plans for their bookings"
  on public.event_plans for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = event_plans.booking_id and b.venue_id = (select public.current_venue_id())));

create policy "admins read event checkins"
  on public.event_checkins for select to authenticated
  using ((select public.is_platform_admin()));

create policy "tenants read own event checkins"
  on public.event_checkins for select to authenticated
  using (tenant_id = (select public.current_company_id()));
