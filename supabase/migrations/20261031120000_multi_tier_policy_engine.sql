-- =============================================================================
-- Multi-tier spend policy
-- -----------------------------------------------------------------------------
-- corporate_policies gains per-head approval tiers and event-context rules; all
-- null / permissive by default, so existing tenants are unaffected until they
-- set them (lib/policies/evaluate-booking-policy.ts):
--   per head <= auto_approval_limit_per_head       in policy, no sign-off
--   per head <= manager_approval_limit_per_head    manager sign-off (approval tier 1)
--   per head >  manager_approval_limit_per_head    CFO sign-off (approval tier 2)
--   venue beyond max_office_distance_km, start outside event_hours_*, a
--   restricted event type, or alcohol on a weekday under
--   weekday_open_bar_policy = 'approval'             manager sign-off
--   weekday_open_bar_policy = 'prohibited'           blocked
--
-- bookings and rfps record what was evaluated: event type and start time, the
-- resulting policy_status, and machine-readable policy_violation_reasons
-- (e.g. {EXCEEDS_PER_HEAD_CAP, OPEN_BAR_WEEKDAY}). Null status = created
-- before this migration.
--
-- Also: tenant users could insert and update their own corporate_policies row,
-- so a requester could raise their own limits. Tenants now read it only;
-- the app writes policies with the service role.
-- =============================================================================

alter table public.corporate_policies
  add column if not exists auto_approval_limit_per_head    numeric(14,2) check (auto_approval_limit_per_head >= 0),
  add column if not exists manager_approval_limit_per_head numeric(14,2) check (manager_approval_limit_per_head >= 0),
  add column if not exists max_office_distance_km          numeric(6,1)  check (max_office_distance_km > 0),
  add column if not exists event_hours_start               time,
  add column if not exists event_hours_end                 time,
  add column if not exists weekday_open_bar_policy         text not null default 'allowed'
    check (weekday_open_bar_policy in ('allowed', 'approval', 'prohibited')),
  add column if not exists restricted_event_types          text[] not null default '{}'
    check (restricted_event_types <@ array['team_meal', 'client_entertainment', 'offsite', 'celebration', 'town_hall', 'workshop', 'other']);

alter table public.corporate_policies drop constraint if exists corporate_policies_per_head_tiers_ordered;
alter table public.corporate_policies add constraint corporate_policies_per_head_tiers_ordered
  check (auto_approval_limit_per_head is null or manager_approval_limit_per_head is null
         or auto_approval_limit_per_head <= manager_approval_limit_per_head);

alter table public.corporate_policies drop constraint if exists corporate_policies_event_hours_paired;
alter table public.corporate_policies add constraint corporate_policies_event_hours_paired
  check ((event_hours_start is null) = (event_hours_end is null));

comment on column public.corporate_policies.auto_approval_limit_per_head is 'Per head (pre-GST) up to which bookings need no sign-off. Null = no per-head tiers.';
comment on column public.corporate_policies.manager_approval_limit_per_head is 'Per head (pre-GST) up to which manager (tier 1) sign-off suffices; above it, CFO (tier 2).';
comment on column public.corporate_policies.max_office_distance_km is 'Venues farther than this from the company office need sign-off. Null = no rule.';
comment on column public.corporate_policies.event_hours_start is 'Events starting outside event_hours_start–event_hours_end (may wrap midnight) need sign-off.';
comment on column public.corporate_policies.weekday_open_bar_policy is 'Alcohol at a Monday–Friday event: allowed | approval (needs sign-off) | prohibited (blocked).';
comment on column public.corporate_policies.restricted_event_types is 'Event types that need sign-off.';

alter table public.bookings
  add column if not exists event_type text
    check (event_type in ('team_meal', 'client_entertainment', 'offsite', 'celebration', 'town_hall', 'workshop', 'other')),
  add column if not exists event_start_time time,
  add column if not exists policy_status text
    check (policy_status in ('in_policy', 'requires_manager', 'requires_cfo', 'out_of_policy')),
  add column if not exists policy_violation_reasons text[] not null default '{}';

alter table public.rfps
  add column if not exists event_type text
    check (event_type in ('team_meal', 'client_entertainment', 'offsite', 'celebration', 'town_hall', 'workshop', 'other')),
  add column if not exists event_start_time time,
  add column if not exists policy_status text
    check (policy_status in ('in_policy', 'requires_manager', 'requires_cfo', 'out_of_policy')),
  add column if not exists policy_violation_reasons text[] not null default '{}';

comment on column public.bookings.policy_status is 'Spend-policy outcome when requested: in_policy | requires_manager | requires_cfo | out_of_policy. Null = before policy tiers.';
comment on column public.bookings.policy_violation_reasons is 'Policy rule codes the request tripped, e.g. {PER_HEAD_MANAGER_TIER, OPEN_BAR_WEEKDAY}.';
comment on column public.rfps.policy_status is 'Spend-policy outcome for the brief when broadcast; see bookings.policy_status.';

-- Tenants read their policy; only admins (and the service role) change it.
drop policy if exists "tenant users manage own policy" on public.corporate_policies;
drop policy if exists "tenant users read own policy" on public.corporate_policies;
create policy "tenant users read own policy"
  on public.corporate_policies for select to authenticated
  using (tenant_id = (select public.current_company_id()));
