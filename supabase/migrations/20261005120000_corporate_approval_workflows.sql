-- =============================================================================
-- 0007 · Corporate workflows, phase 1: spend policies + booking approvals
-- -----------------------------------------------------------------------------
-- A "tenant" is a corporate account, i.e. public.companies.id. Client portal
-- users already belong to one company via platform_users.company_id, so RLS
-- scopes every table here with public.current_company_id().
--
--   corporate_policies  one row per tenant: per-head cap and approval threshold
--   approval_chains     ordered tiers of approvers for a tenant
--   booking_approvals   one approval request per (booking, approver)
--
-- Tenant membership is enforced by composite foreign keys, not only by RLS:
-- an approval can only reference a booking of its own tenant, and requesters /
-- approvers must be platform users of that same tenant. The service role
-- (auth.uid() is null) bypasses RLS as elsewhere but still hits these keys.
-- =============================================================================

do $$ begin
  create type public.approval_status as enum ('PENDING', 'APPROVED', 'REJECTED');
exception when duplicate_object then null; end $$;

-- Composite keys that let child tables prove tenant membership ---------------------
-- (id / user_id are already unique, so these never reject existing rows.)
alter table public.bookings
  add constraint bookings_id_company_id_key unique (id, company_id);

alter table public.platform_users
  add constraint platform_users_user_id_company_id_key unique (user_id, company_id);

-- corporate_policies -----------------------------------------------------------------
create table if not exists public.corporate_policies (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null unique references public.companies (id) on delete cascade,
  -- null = no cap / no approval needed
  max_budget_per_head      numeric(14,2) check (max_budget_per_head >= 0),
  -- Bookings are priced in INR only; widen this check when multi-currency lands
  -- so thresholds are never compared against amounts in another currency.
  currency                 char(3) not null default 'INR' check (currency = 'INR'),
  requires_approval_above  numeric(14,2) check (requires_approval_above >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table  public.corporate_policies is 'Per-tenant (company) booking policy. One row per tenant.';
comment on column public.corporate_policies.tenant_id is 'The corporate account (companies.id) this policy governs.';
comment on column public.corporate_policies.max_budget_per_head is 'Per-head budget cap, pre-GST. Null = no cap.';
comment on column public.corporate_policies.requires_approval_above is
  'Bookings whose pre-GST total exceeds this need approval. Null = approval never required.';

create trigger corporate_policies_set_updated_at
  before update on public.corporate_policies
  for each row execute function public.set_updated_at();

-- approval_chains --------------------------------------------------------------------
create table if not exists public.approval_chains (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.companies (id) on delete cascade,
  approver_user_id  uuid not null,
  tier_level        smallint not null check (tier_level between 1 and 10),
  created_at        timestamptz not null default now(),
  constraint approval_chains_tenant_tier_key unique (tenant_id, tier_level),
  constraint approval_chains_approver_fkey
    foreign key (approver_user_id, tenant_id)
    references public.platform_users (user_id, company_id) on delete cascade
);

comment on table  public.approval_chains is 'Approval tiers per tenant; tier 1 approves first.';
comment on column public.approval_chains.approver_user_id is 'Must be a platform user of the same tenant (enforced by FK).';

create index if not exists approval_chains_approver_user_id_idx on public.approval_chains (approver_user_id);

-- booking_approvals ------------------------------------------------------------------
create table if not exists public.booking_approvals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.companies (id) on delete cascade,
  booking_id    uuid not null,
  requested_by  uuid not null default auth.uid(),
  approver_id   uuid not null,
  status        public.approval_status not null default 'PENDING',
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint booking_approvals_booking_fkey
    foreign key (booking_id, tenant_id)
    references public.bookings (id, company_id) on delete cascade,
  constraint booking_approvals_requested_by_fkey
    foreign key (requested_by, tenant_id)
    references public.platform_users (user_id, company_id),
  constraint booking_approvals_approver_fkey
    foreign key (approver_id, tenant_id)
    references public.platform_users (user_id, company_id),
  constraint booking_approvals_no_self_approval check (approver_id <> requested_by)
);

comment on table  public.booking_approvals is 'Approval requests for bookings. APPROVED / REJECTED are final.';
comment on column public.booking_approvals.reason is 'Requester justification or approver decision note.';

create index if not exists booking_approvals_tenant_id_idx   on public.booking_approvals (tenant_id);
create index if not exists booking_approvals_approver_id_idx on public.booking_approvals (approver_id);
-- At most one open request per booking per approver.
create unique index if not exists booking_approvals_one_pending_idx
  on public.booking_approvals (booking_id, approver_id) where status = 'PENDING';

create trigger booking_approvals_set_updated_at
  before update on public.booking_approvals
  for each row execute function public.set_updated_at();

-- Decisions are final; portal users may only change status and reason -------------
-- Mirrors bookings_guard_status_transition + bookings_guard_portal_columns.
create or replace function public.booking_approvals_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'PENDING' and new.status is distinct from old.status then
    raise exception 'Approval % is already % and cannot move to %', old.id, old.status, new.status;
  end if;

  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;

  if old.status <> 'PENDING' then
    raise exception 'Approval % is already % and can no longer be edited', old.id, old.status
      using errcode = '42501';
  end if;

  if (new.id, new.tenant_id, new.booking_id, new.requested_by, new.approver_id, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.booking_id, old.requested_by, old.approver_id, old.created_at)
  then
    raise exception 'Only the status and reason of approval % can be changed from a portal', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger booking_approvals_guard_update
  before update on public.booking_approvals
  for each row execute function public.booking_approvals_guard_update();

-- Row Level Security -------------------------------------------------------------------
alter table public.corporate_policies enable row level security;
alter table public.approval_chains    enable row level security;
alter table public.booking_approvals  enable row level security;

-- corporate_policies: tenant users read/write their own tenant's policy
create policy "admins manage corporate policies"
  on public.corporate_policies for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "tenant users manage own policy"
  on public.corporate_policies for all to authenticated
  using (tenant_id = public.current_company_id())
  with check (tenant_id = public.current_company_id());

-- approval_chains: tenant users read/write their own tenant's chain
create policy "admins manage approval chains"
  on public.approval_chains for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "tenant users manage own approval chain"
  on public.approval_chains for all to authenticated
  using (tenant_id = public.current_company_id())
  with check (tenant_id = public.current_company_id());

-- booking_approvals: tenant users read all of their tenant's requests, raise them
-- as themselves, and only the assigned approver can decide one.
create policy "admins manage booking approvals"
  on public.booking_approvals for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "tenant users read own approvals"
  on public.booking_approvals for select to authenticated
  using (tenant_id = public.current_company_id());

create policy "tenant users request approvals"
  on public.booking_approvals for insert to authenticated
  with check (
    tenant_id = public.current_company_id()
    and requested_by = auth.uid()
    and status = 'PENDING'
  );

create policy "approvers decide own approvals"
  on public.booking_approvals for update to authenticated
  using (tenant_id = public.current_company_id() and approver_id = auth.uid())
  with check (tenant_id = public.current_company_id() and approver_id = auth.uid());
