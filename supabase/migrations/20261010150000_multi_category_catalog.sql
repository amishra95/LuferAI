-- =============================================================================
-- 0021 · Multi-category catalogue: gifting, tickets, merch, team building, dining
-- -----------------------------------------------------------------------------
-- Partners (the /partner extranet) list catalogue items in a category, each
-- with its own HSN/SAC code and GST rate and category-specific attributes
-- (sizes, ticket tiers, headcount limits, …; validated in lib/catalog/items.ts).
-- Companies order them as catalog_orders, which go through the same machinery
-- as venue bookings: approvals, blanket PO allocations and expense exports now
-- reference either a booking or an order (exactly one).
--
-- Order lifecycle (guarded below; mirrored in lib/catalog/orders.ts):
--   PENDING_APPROVAL → PLACED → CONFIRMED → [SHIPPED →] DELIVERED → SETTLED
--   CANCELLED from PENDING_APPROVAL, PLACED or CONFIRMED.
-- The supplier fulfils (confirm, ship with tracking, deliver) from /partner.
-- =============================================================================

-- 1 · Suppliers need a GSTIN to invoice goods and services -------------------------------------
alter table public.partners
  add column if not exists gstin char(15) check (gstin is null or public.is_valid_gstin(gstin));

comment on column public.partners.gstin is 'Supplier GSTIN, required to list catalogue items (it is the supplier on their invoices).';

-- 2 · Catalogue items --------------------------------------------------------------------------
create table if not exists public.catalog_items (
  id               uuid primary key default gen_random_uuid(),
  partner_id       uuid not null references public.partners (id) on delete cascade,
  category         text not null check (category in ('dining', 'gifting', 'tickets', 'merch', 'team_building')),
  ref              text not null check (ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  description      text check (description is null or char_length(description) <= 1000),
  -- Per unit: a gift, a ticket (base tier), a garment, or a participant.
  unit_price_inr   numeric(14,2) not null check (unit_price_inr >= 0),
  tax_kind         text not null check (tax_kind in ('HSN', 'SAC')),
  tax_code         text not null check (tax_code ~ '^[0-9]{4,8}$'),
  gst_rate_percent smallint not null check (gst_rate_percent in (0, 5, 12, 18, 28)),
  min_quantity     integer not null default 1 check (min_quantity >= 1),
  max_quantity     integer check (max_quantity is null or max_quantity >= min_quantity),
  -- Category-specific: sizes, ticket tiers, event date/venue, duration, lead time, contains_alcohol…
  attributes       jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  status           text not null default 'active' check (status in ('active', 'paused')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (partner_id, ref)
);

comment on table public.catalog_items is 'Partner catalogue: non-venue supply (gifts, tickets, merch, team building, dining packages).';

create index if not exists catalog_items_category_idx on public.catalog_items (category, status);

create trigger catalog_items_set_updated_at
  before update on public.catalog_items
  for each row execute function public.set_updated_at();

-- 3 · Catalogue orders -------------------------------------------------------------------------
create table if not exists public.catalog_orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.companies (id) on delete restrict,
  item_id           uuid not null references public.catalog_items (id) on delete restrict,
  partner_id        uuid not null references public.partners (id) on delete restrict,
  category          text not null check (category in ('dining', 'gifting', 'tickets', 'merch', 'team_building')),
  quantity          integer not null check (quantity >= 1),
  unit_price_inr    numeric(14,2) not null check (unit_price_inr >= 0),
  -- Pre-GST; tax is snapshotted on the invoice.
  total_amount_inr  numeric(14,2) not null check (total_amount_inr >= 0),
  invoice           jsonb not null,
  -- Event date (tickets, team building, dining) or the date goods are needed by.
  event_date        date,
  needed_by         date,
  -- What was chosen: ticket tier, sizes per recipient, …
  selections        jsonb not null default '{}'::jsonb check (jsonb_typeof(selections) = 'object'),
  -- Gifting/merch: [{ name, email?, phone?, address, size? }]. Visible to the buyer and the supplier only.
  recipients        jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients) = 'array'),
  tracking          jsonb,
  status            text not null default 'PLACED'
                      check (status in ('PENDING_APPROVAL', 'PLACED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'SETTLED', 'CANCELLED')),
  department_id     uuid references public.departments (id) on delete set null,
  cost_center       text not null check (char_length(btrim(cost_center)) between 1 and 40),
  project_code      text,
  requested_by      uuid,
  notes             text check (notes is null or char_length(notes) <= 500),
  settled_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint catalog_orders_date_check check (event_date is not null or needed_by is not null),
  -- Target for the approvals' composite key (an approval can't point at another tenant's order).
  constraint catalog_orders_id_tenant_key unique (id, tenant_id)
);

comment on table public.catalog_orders is 'Catalogue orders: the non-venue counterpart of bookings.';

create index if not exists catalog_orders_tenant_idx  on public.catalog_orders (tenant_id, created_at desc);
create index if not exists catalog_orders_partner_idx on public.catalog_orders (partner_id, status);

create trigger catalog_orders_set_updated_at
  before update on public.catalog_orders
  for each row execute function public.set_updated_at();

create or replace function public.catalog_orders_guard_status()
returns trigger
language plpgsql
as $$
declare
  allowed text[];
begin
  if old.status = new.status then
    return new;
  end if;
  allowed := case old.status
    when 'PENDING_APPROVAL' then array['PLACED', 'CANCELLED']
    when 'PLACED'           then array['CONFIRMED', 'CANCELLED']
    when 'CONFIRMED'        then array['SHIPPED', 'DELIVERED', 'CANCELLED']
    when 'SHIPPED'          then array['DELIVERED']
    when 'DELIVERED'        then array['SETTLED']
    else array[]::text[]
  end;
  if not new.status = any (allowed) then
    raise exception 'A % order can''t become %', old.status, new.status;
  end if;
  if new.status = 'SETTLED' then
    new.settled_at := coalesce(new.settled_at, now());
  end if;
  return new;
end;
$$;

create trigger catalog_orders_guard_status
  before update of status on public.catalog_orders
  for each row execute function public.catalog_orders_guard_status();

-- 4 · Approvals: a booking or an order ---------------------------------------------------------
alter table public.booking_approvals
  alter column booking_id drop not null,
  add column if not exists catalog_order_id uuid,
  add constraint booking_approvals_order_fkey
    foreign key (catalog_order_id, tenant_id) references public.catalog_orders (id, tenant_id) on delete cascade,
  add constraint booking_approvals_subject_check check ((booking_id is null) <> (catalog_order_id is null));

create unique index if not exists booking_approvals_one_pending_order_idx
  on public.booking_approvals (catalog_order_id, approver_id) where status = 'PENDING';

create or replace function public.booking_approvals_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'PENDING' and new.status is distinct from old.status then
    raise exception 'Approval % is already % and cannot move to %', old.id, old.status, new.status;
  end if;

  if new.status is distinct from old.status then
    new.decided_at := now();
  else
    new.decided_at := old.decided_at;
  end if;

  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;

  if old.status <> 'PENDING' then
    raise exception 'Approval % is already % and can no longer be edited', old.id, old.status
      using errcode = '42501';
  end if;

  if (new.id, new.tenant_id, new.booking_id, new.catalog_order_id, new.requested_by, new.approver_id, new.reason, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.booking_id, old.catalog_order_id, old.requested_by, old.approver_id, old.reason, old.created_at)
  then
    raise exception 'Only the status and decision note of approval % can be changed from a portal', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- The decision moves whichever it approves: a booking to the venue, an order to the supplier.
create or replace function public.booking_approvals_apply_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  all_approved boolean;
begin
  all_approved := not exists (
    select 1 from public.booking_approvals a
    where a.id <> new.id and a.status <> 'APPROVED'
      and (a.booking_id = new.booking_id or a.catalog_order_id = new.catalog_order_id)
  );
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

-- 5 · PO allocations: a booking or an order ----------------------------------------------------
alter table public.po_allocations
  alter column booking_id drop not null,
  add column if not exists catalog_order_id uuid unique references public.catalog_orders (id) on delete cascade,
  add constraint po_allocations_subject_check check ((booking_id is null) <> (catalog_order_id is null));

create or replace function public.po_allocations_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  po          public.purchase_orders%rowtype;
  subject_tenant uuid;
  subject_date   date;
  subject_dept   uuid;
  drawn       numeric(14,2);
begin
  if new.status = 'released' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.po_id = old.po_id and new.amount_inr <= old.amount_inr and old.status <> 'released' then
    return new;
  end if;

  select * into po from public.purchase_orders where id = new.po_id for update;
  if new.booking_id is not null then
    select company_id, event_date, department_id into subject_tenant, subject_date, subject_dept
      from public.bookings where id = new.booking_id;
  else
    select tenant_id, coalesce(event_date, needed_by), department_id into subject_tenant, subject_date, subject_dept
      from public.catalog_orders where id = new.catalog_order_id;
  end if;

  if po.tenant_id <> new.tenant_id or subject_tenant <> new.tenant_id then
    raise exception 'PO % belongs to another company', po.po_number using errcode = '42501';
  end if;
  if po.status <> 'open' then
    raise exception 'PO % is closed', po.po_number using errcode = '23514';
  end if;
  if subject_date not between po.valid_from and po.valid_to then
    raise exception 'PO % is not valid on %', po.po_number, subject_date using errcode = '23514';
  end if;
  if po.department_id is not null and subject_dept is distinct from po.department_id then
    raise exception 'PO % is for another department', po.po_number using errcode = '23514';
  end if;

  if not new.over_balance then
    select coalesce(sum(amount_inr), 0) into drawn
      from public.po_allocations
      where po_id = new.po_id and status <> 'released' and id <> new.id;
    if drawn + new.amount_inr > po.amount_inr then
      raise exception 'PO % has % left, not enough for %', po.po_number, po.amount_inr - drawn, new.amount_inr
        using errcode = '23514', hint = 'po_balance';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.catalog_orders_sync_po_allocations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.po_allocations
     set status = case
       when new.status = 'CANCELLED' then 'released'
       when new.status in ('DELIVERED', 'SETTLED') then 'consumed'
       else 'committed' end
   where catalog_order_id = new.id;
  return new;
end;
$$;

create trigger catalog_orders_sync_po_allocations
  after update of status on public.catalog_orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.catalog_orders_sync_po_allocations();

-- 6 · Expense exports: a booking or an order ---------------------------------------------------
alter table public.expense_exports
  alter column booking_id drop not null,
  add column if not exists catalog_order_id uuid references public.catalog_orders (id) on delete cascade,
  add constraint expense_exports_subject_check check ((booking_id is null) <> (catalog_order_id is null)),
  add constraint expense_exports_order_event_key unique (catalog_order_id, event);

alter table public.expense_exports drop constraint if exists expense_exports_event_check;
alter table public.expense_exports
  add constraint expense_exports_event_check check (event in ('booking.confirmed', 'order.confirmed'));

-- 7 · Partner audit log covers catalogue items and order fulfilment ----------------------------
alter table public.partner_audit_log drop constraint if exists partner_audit_log_entity_check;
alter table public.partner_audit_log
  add constraint partner_audit_log_entity_check
  check (entity in ('listing', 'rate_card', 'member', 'partner', 'catalog_item', 'catalog_order'));

-- 8 · Row Level Security -----------------------------------------------------------------------
alter table public.catalog_items  enable row level security;
alter table public.catalog_orders enable row level security;

create policy "admins manage catalog items"
  on public.catalog_items for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "authenticated read active catalog items"
  on public.catalog_items for select to authenticated
  using (status = 'active');

create policy "partners read own catalog items"
  on public.catalog_items for select to authenticated
  using (partner_id = (select public.current_partner_id()));

create policy "admins manage catalog orders"
  on public.catalog_orders for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "tenant users read own catalog orders"
  on public.catalog_orders for select to authenticated
  using (tenant_id = (select public.current_company_id()));

-- Suppliers see the orders they fulfil, including recipients (they ship to them).
create policy "partners read own catalog orders"
  on public.catalog_orders for select to authenticated
  using (partner_id = (select public.current_partner_id()));
