-- =============================================================================
-- 0030 · Enterprise governance: approval rules, sequential sign-off, escalation,
--        and monthly/quarterly team budgets with balance holds
-- -----------------------------------------------------------------------------
-- Builds on the existing model rather than beside it: a corporate organisation
-- is public.companies, a team is public.departments, the approval hierarchy is
-- approval_chains (tier 1 approves first) and an approval request is a
-- booking_approvals row (0007–0009, 0021).
--
--   approval_policy_rules  Amount bands per company (optionally per department):
--                          a request whose pre-GST total falls in (min, max] needs
--                          `approval_levels` tiers of the chain, one after another,
--                          each with `sla_hours` to decide before it escalates.
--                          Totals at or below every band bypass rule-based sign-off.
--   booking_approvals      + step / activated_at / due_at: steps run in order; a
--                          queued step (activated_at null) can't be decided until
--                          the step before it is approved. + ESCALATED (0030a):
--                          the row is closed and the next tier up takes it over
--                          at the same step (escalated_from links the two).
--   team_budgets           A department's monthly or quarterly limit (pre-GST).
--                          enforcement 'approval': spend past it needs sign-off;
--                          'block': spend past it is refused outright.
--   budget_holds           What each booking or order draws from a budget:
--                            held       awaiting approval (balance reserved)
--                            committed  approved: with the venue / supplier
--                            consumed   the event happened / goods delivered
--                            released   cancelled: the amount goes back
--                          Balance = limit − everything not released. The check
--                          locks the budget row, so two concurrent requests can't
--                          both spend the last of it.
--
-- Rows written before this migration keep working as they did: their approvals
-- are active (activated_at = now()) with no deadline, so nothing auto-escalates.
-- The app writes rules, budgets and holds through the service role
-- (lib/services/enterprise); tenant users read their own company's rows.
-- =============================================================================

-- 1 · Approval rules -------------------------------------------------------------------------
create table if not exists public.approval_policy_rules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.companies (id) on delete cascade,
  -- null = every department; a department's own rule wins over a company-wide one.
  department_id    uuid,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  min_amount_inr   numeric(14,2) not null default 0 check (min_amount_inr >= 0),
  -- null = no upper bound
  max_amount_inr   numeric(14,2) check (max_amount_inr is null or max_amount_inr > min_amount_inr),
  approval_levels  smallint not null check (approval_levels between 1 and 10),
  sla_hours        integer not null default 48 check (sla_hours between 1 and 720),
  is_active        boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint approval_policy_rules_department_fkey
    foreign key (department_id, tenant_id) references public.departments (id, company_id) on delete cascade,
  -- One active rule per amount, per scope: bands are (min, max].
  constraint approval_policy_rules_no_overlap exclude using gist (
    tenant_id with =,
    (coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    numrange(min_amount_inr, max_amount_inr, '(]') with &&
  ) where (is_active)
);

comment on table  public.approval_policy_rules is 'Amount bands that decide how many approval_chains tiers sign off, in order.';
comment on column public.approval_policy_rules.min_amount_inr is 'Exclusive lower bound, pre-GST: the rule applies to totals above it.';
comment on column public.approval_policy_rules.max_amount_inr is 'Inclusive upper bound, pre-GST. Null = no upper bound.';
comment on column public.approval_policy_rules.approval_levels is 'Tiers of the chain that sign off, lowest first (the requester is skipped).';
comment on column public.approval_policy_rules.sla_hours is 'Hours each step has to decide before it escalates to the next tier.';

create index if not exists approval_policy_rules_tenant_idx on public.approval_policy_rules (tenant_id, is_active);

create trigger approval_policy_rules_set_updated_at
  before update on public.approval_policy_rules
  for each row execute function public.set_updated_at();

-- 2 · Sequential steps and escalation on booking_approvals -----------------------------------
alter table public.booking_approvals
  add column if not exists step           smallint not null default 1 check (step between 1 and 10),
  -- When the step became the approver's to decide; null = queued behind an earlier step.
  add column if not exists activated_at   timestamptz default now(),
  -- Decide by then or it escalates. Null = no deadline.
  add column if not exists due_at         timestamptz,
  add column if not exists rule_id        uuid references public.approval_policy_rules (id) on delete set null,
  add column if not exists escalated_from uuid references public.booking_approvals (id) on delete set null;

alter table public.booking_approvals
  add constraint booking_approvals_due_needs_activation check (due_at is null or activated_at is not null);

comment on column public.booking_approvals.step is 'Position in the sign-off sequence; step n+1 activates once step n is approved.';
comment on column public.booking_approvals.activated_at is 'When it became the approver''s turn. Null = queued behind an earlier step.';
comment on column public.booking_approvals.due_at is 'Escalates to the next tier if still pending then. Set from the rule''s sla_hours.';
comment on column public.booking_approvals.escalated_from is 'The ESCALATED approval this one took over from.';

create index if not exists booking_approvals_due_idx on public.booking_approvals (due_at) where status = 'PENDING';

-- The deadline follows from the rule whenever a step is activated.
create or replace function public.booking_approvals_set_due_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.activated_at is not null and new.due_at is null and new.rule_id is not null
     and (tg_op = 'INSERT' or old.activated_at is null) then
    select new.activated_at + make_interval(hours => r.sla_hours) into new.due_at
      from public.approval_policy_rules r where r.id = new.rule_id;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_approvals_set_due_at on public.booking_approvals;
create trigger booking_approvals_set_due_at
  before insert or update of activated_at on public.booking_approvals
  for each row execute function public.booking_approvals_set_due_at();

-- Queued steps can't be decided by anyone; only escalate_booking_approval escalates.
-- Changes made by this migration's own triggers (activating the next step) pass.
create or replace function public.booking_approvals_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'PENDING' and new.status is distinct from old.status then
    raise exception 'Approval % is already % and cannot move to %', old.id, old.status, new.status;
  end if;

  if old.activated_at is null and new.status in ('APPROVED', 'REJECTED') then
    raise exception 'Approval % is waiting for an earlier step to be approved', old.id
      using errcode = '23514', hint = 'approval_queued';
  end if;

  if new.status is distinct from old.status then
    new.decided_at := now();
  else
    new.decided_at := old.decided_at;
  end if;

  if auth.uid() is null or public.is_platform_admin() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.status <> 'PENDING' then
    raise exception 'Approval % is already % and can no longer be edited', old.id, old.status
      using errcode = '42501';
  end if;

  if new.status = 'ESCALATED' then
    raise exception 'Approval % can only be escalated by the platform', old.id
      using errcode = '42501';
  end if;

  if (new.id, new.tenant_id, new.booking_id, new.catalog_order_id, new.requested_by, new.approver_id, new.reason, new.created_at,
      new.step, new.activated_at, new.due_at, new.rule_id, new.escalated_from)
     is distinct from
     (old.id, old.tenant_id, old.booking_id, old.catalog_order_id, old.requested_by, old.approver_id, old.reason, old.created_at,
      old.step, old.activated_at, old.due_at, old.rule_id, old.escalated_from)
  then
    raise exception 'Only the status and decision note of approval % can be changed from a portal', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- An approval activates the next queued step; the last one (or any rejection) moves the
-- booking to the venue or the order to the supplier, as before. ESCALATED rows are
-- superseded by their replacement and never hold anything up.
create or replace function public.booking_approvals_apply_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  all_approved boolean;
  next_step    smallint;
begin
  if new.status = 'ESCALATED' then
    return null;
  end if;

  all_approved := not exists (
    select 1 from public.booking_approvals a
    where a.id <> new.id and a.status not in ('APPROVED', 'ESCALATED')
      and (a.booking_id = new.booking_id or a.catalog_order_id = new.catalog_order_id)
  );

  if new.status = 'APPROVED' and not all_approved and not exists (
    select 1 from public.booking_approvals a
    where a.status = 'PENDING' and a.activated_at is not null
      and (a.booking_id = new.booking_id or a.catalog_order_id = new.catalog_order_id)
  ) then
    select min(a.step) into next_step from public.booking_approvals a
    where a.status = 'PENDING' and a.activated_at is null
      and (a.booking_id = new.booking_id or a.catalog_order_id = new.catalog_order_id);
    update public.booking_approvals a set activated_at = now()
    where a.status = 'PENDING' and a.activated_at is null and a.step = next_step
      and (a.booking_id = new.booking_id or a.catalog_order_id = new.catalog_order_id);
  end if;

  if new.booking_id is not null then
    if new.status = 'REJECTED' then
      update public.bookings set status = 'CANCELLED' where id = new.booking_id and status = 'PENDING_APPROVAL';
    elsif new.status = 'APPROVED' and all_approved then
      update public.bookings set status = 'PENDING' where id = new.booking_id and status = 'PENDING_APPROVAL';
    end if;
  else
    if new.status = 'REJECTED' then
      update public.catalog_orders set status = 'CANCELLED' where id = new.catalog_order_id and status = 'PENDING_APPROVAL';
    elsif new.status = 'APPROVED' and all_approved then
      update public.catalog_orders set status = 'PLACED' where id = new.catalog_order_id and status = 'PENDING_APPROVAL';
    end if;
  end if;
  return null;
end;
$$;

-- Hands a waiting approval to the next tier up the chain that isn't the requester and isn't
-- already on the request. Returns the new approval's id. Raises 23514 (hint
-- no_escalation_target) when there's nobody left to escalate to.
create or replace function public.escalate_booking_approval(p_approval_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a            public.booking_approvals%rowtype;
  current_tier smallint;
  target       uuid;
  new_id       uuid;
begin
  select * into a from public.booking_approvals where id = p_approval_id for update;
  if not found then
    raise exception 'Approval % not found', p_approval_id using errcode = 'P0002';
  end if;
  if a.status <> 'PENDING' or a.activated_at is null then
    raise exception 'Only an approval waiting on its approver can be escalated (% is %)', a.id,
      case when a.status = 'PENDING' then 'queued' else lower(a.status::text) end
      using errcode = '23514', hint = 'not_escalatable';
  end if;

  select c.tier_level into current_tier
    from public.approval_chains c where c.tenant_id = a.tenant_id and c.approver_user_id = a.approver_id;

  select c.approver_user_id into target
    from public.approval_chains c
   where c.tenant_id = a.tenant_id
     and c.tier_level > coalesce(current_tier, 0)
     and c.approver_user_id <> a.requested_by
     and not exists (
       select 1 from public.booking_approvals x
        where x.approver_id = c.approver_user_id and x.status in ('PENDING', 'APPROVED')
          and (x.booking_id = a.booking_id or x.catalog_order_id = a.catalog_order_id))
   order by c.tier_level
   limit 1;
  if target is null then
    raise exception 'There is no higher approver to escalate approval % to', a.id
      using errcode = '23514', hint = 'no_escalation_target';
  end if;

  update public.booking_approvals
     set status = 'ESCALATED', decision_note = coalesce(nullif(btrim(p_reason), ''), 'Escalated: no decision before the deadline')
   where id = a.id;

  insert into public.booking_approvals
    (tenant_id, booking_id, catalog_order_id, requested_by, approver_id, reason, step, rule_id, escalated_from, activated_at)
  values
    (a.tenant_id, a.booking_id, a.catalog_order_id, a.requested_by, target, a.reason, a.step, a.rule_id, a.id, now())
  returning id into new_id;
  return new_id;
end;
$$;

-- Escalates every overdue approval that has somewhere to go. Returns how many moved.
create or replace function public.escalate_overdue_approvals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  moved integer := 0;
begin
  for r in
    select id from public.booking_approvals
     where status = 'PENDING' and due_at < now()
     order by due_at
  loop
    begin
      perform public.escalate_booking_approval(r.id, 'Escalated automatically: no decision within the approval deadline');
      moved := moved + 1;
    exception when sqlstate '23514' then
      -- Nobody higher up: it stays with its approver and is retried on the next sweep.
      null;
    end;
  end loop;
  return moved;
end;
$$;

-- Replaces a company's approval hierarchy in one statement: p_approvers[1] becomes tier 1.
-- Approvals already raised keep their approvers; new requests follow the new order.
create or replace function public.replace_approval_chain(p_tenant_id uuid, p_approvers uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := coalesce(array_length(p_approvers, 1), 0);
begin
  if n > 10 then
    raise exception 'An approval chain has at most 10 tiers' using errcode = '23514', hint = 'chain';
  end if;
  if (select count(distinct x) from unnest(p_approvers) x) <> n then
    raise exception 'Each approver can hold only one tier' using errcode = '23514', hint = 'chain';
  end if;
  delete from public.approval_chains where tenant_id = p_tenant_id;
  insert into public.approval_chains (tenant_id, approver_user_id, tier_level)
  select p_tenant_id, t.approver, t.tier::smallint from unnest(p_approvers) with ordinality as t(approver, tier);
end;
$$;

revoke all on function public.escalate_booking_approval(uuid, text) from public, anon, authenticated;
revoke all on function public.escalate_overdue_approvals() from public, anon, authenticated;
revoke all on function public.replace_approval_chain(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.escalate_booking_approval(uuid, text) to service_role;
grant execute on function public.escalate_overdue_approvals() to service_role;
grant execute on function public.replace_approval_chain(uuid, uuid[]) to service_role;

-- 3 · Team budgets ---------------------------------------------------------------------------
create table if not exists public.team_budgets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.companies (id) on delete cascade,
  department_id  uuid not null,
  period         text not null check (period in ('monthly', 'quarterly')),
  period_start   date not null,
  period_end     date generated always as (
    (period_start + case when period = 'monthly' then interval '1 month' else interval '3 months' end - interval '1 day')::date
  ) stored,
  limit_inr      numeric(14,2) not null check (limit_inr > 0),
  currency       char(3) not null default 'INR' check (currency = 'INR'),
  enforcement    text not null default 'approval' check (enforcement in ('approval', 'block')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint team_budgets_department_fkey
    foreign key (department_id, tenant_id) references public.departments (id, company_id) on delete cascade,
  -- Months start on the 1st; quarters are the Indian FY's (Apr, Jul, Oct, Jan).
  constraint team_budgets_period_aligned check (
    extract(day from period_start) = 1 and (period = 'monthly' or extract(month from period_start) in (1, 4, 7, 10))
  ),
  constraint team_budgets_period_key unique (department_id, period, period_start),
  constraint team_budgets_id_tenant_key unique (id, tenant_id)
);

comment on table  public.team_budgets is 'A department''s monthly or quarterly spend limit, pre-GST. budget_holds draw from it.';
comment on column public.team_budgets.enforcement is 'approval: spend past the limit needs sign-off · block: it is refused.';

create index if not exists team_budgets_tenant_idx on public.team_budgets (tenant_id, period_start);

create trigger team_budgets_set_updated_at
  before update on public.team_budgets
  for each row execute function public.set_updated_at();

create table if not exists public.budget_holds (
  id                uuid primary key default gen_random_uuid(),
  budget_id         uuid not null,
  tenant_id         uuid not null references public.companies (id) on delete cascade,
  booking_id        uuid,
  catalog_order_id  uuid,
  amount_inr        numeric(14,2) not null check (amount_inr >= 0),
  -- Derived from the booking / order on insert and kept in step by triggers.
  status            text not null default 'held' check (status in ('held', 'committed', 'consumed', 'released')),
  -- Allowed past the budget's balance because the request goes through sign-off.
  over_budget       boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint budget_holds_budget_fkey
    foreign key (budget_id, tenant_id) references public.team_budgets (id, tenant_id) on delete restrict,
  constraint budget_holds_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade,
  constraint budget_holds_order_fkey
    foreign key (catalog_order_id, tenant_id) references public.catalog_orders (id, tenant_id) on delete cascade,
  constraint budget_holds_subject_check check ((booking_id is null) <> (catalog_order_id is null)),
  constraint budget_holds_booking_key unique (budget_id, booking_id),
  constraint budget_holds_order_key unique (budget_id, catalog_order_id)
);

comment on table public.budget_holds is 'The budget ledger: what each booking or order draws from which team budget.';

create index if not exists budget_holds_budget_idx on public.budget_holds (budget_id, status);
create index if not exists budget_holds_booking_idx on public.budget_holds (booking_id);
create index if not exists budget_holds_order_idx on public.budget_holds (catalog_order_id);

create trigger budget_holds_set_updated_at
  before update on public.budget_holds
  for each row execute function public.set_updated_at();

create or replace function public.budget_hold_status_for(subject_status text)
returns text
language sql
immutable
as $$
  select case
    when subject_status = 'PENDING_APPROVAL' then 'held'
    when subject_status = 'CANCELLED' then 'released'
    when subject_status in ('COMPLETED', 'SETTLED', 'DELIVERED') then 'consumed'
    else 'committed' end
$$;

-- Same department, inside the period, and within the balance (or flagged for sign-off,
-- which a 'block' budget never allows).
create or replace function public.budget_holds_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  b              public.team_budgets%rowtype;
  subject_status text;
  subject_date   date;
  subject_dept   uuid;
  drawn          numeric(14,2);
begin
  if new.booking_id is not null then
    select status::text, event_date, department_id into subject_status, subject_date, subject_dept
      from public.bookings where id = new.booking_id;
  else
    select status, coalesce(event_date, needed_by, created_at::date), department_id into subject_status, subject_date, subject_dept
      from public.catalog_orders where id = new.catalog_order_id;
  end if;
  if tg_op = 'INSERT' then
    new.status := public.budget_hold_status_for(subject_status);
  end if;

  if new.status = 'released' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.budget_id = old.budget_id and new.amount_inr <= old.amount_inr
     and new.over_budget = old.over_budget and old.status <> 'released' then
    return new;
  end if;

  select * into b from public.team_budgets where id = new.budget_id for update;
  if subject_dept is distinct from b.department_id then
    raise exception 'This budget is for another department' using errcode = '23514', hint = 'budget_scope';
  end if;
  if subject_date not between b.period_start and b.period_end then
    raise exception 'The budget covers % to %, not %', b.period_start, b.period_end, subject_date
      using errcode = '23514', hint = 'budget_scope';
  end if;
  if new.over_budget and b.enforcement = 'block' then
    raise exception 'This budget is a hard cap: spend past it can''t be approved' using errcode = '23514', hint = 'budget_cap';
  end if;

  if not new.over_budget then
    select coalesce(sum(amount_inr), 0) into drawn
      from public.budget_holds
     where budget_id = new.budget_id and status <> 'released' and id <> new.id;
    if drawn + new.amount_inr > b.limit_inr then
      raise exception 'The budget has % left, not enough for %', b.limit_inr - drawn, new.amount_inr
        using errcode = '23514', hint = 'budget_balance';
    end if;
  end if;
  return new;
end;
$$;

create trigger budget_holds_check
  before insert or update on public.budget_holds
  for each row execute function public.budget_holds_check();

-- Holds follow their booking or order (as PO allocations do).
create or replace function public.bookings_sync_budget_holds()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.budget_holds set status = public.budget_hold_status_for(new.status::text)
   where booking_id = new.id;
  return new;
end;
$$;

create trigger bookings_sync_budget_holds
  after update of status on public.bookings
  for each row
  when (old.status is distinct from new.status)
  execute function public.bookings_sync_budget_holds();

create or replace function public.catalog_orders_sync_budget_holds()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.budget_holds set status = public.budget_hold_status_for(new.status)
   where catalog_order_id = new.id;
  return new;
end;
$$;

create trigger catalog_orders_sync_budget_holds
  after update of status on public.catalog_orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.catalog_orders_sync_budget_holds();

-- Row Level Security -------------------------------------------------------------------------
alter table public.approval_policy_rules enable row level security;
alter table public.team_budgets          enable row level security;
alter table public.budget_holds          enable row level security;

create policy "admins manage approval policy rules"
  on public.approval_policy_rules for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "tenant users read own approval policy rules"
  on public.approval_policy_rules for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "admins manage team budgets"
  on public.team_budgets for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "tenant users read own team budgets"
  on public.team_budgets for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "admins manage budget holds"
  on public.budget_holds for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "tenant users read own budget holds"
  on public.budget_holds for select to authenticated
  using (tenant_id = (select public.current_company_id()));
