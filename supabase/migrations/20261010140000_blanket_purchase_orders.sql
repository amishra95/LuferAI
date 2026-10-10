-- =============================================================================
-- 0020 · Blanket purchase orders and the allocation ledger
-- -----------------------------------------------------------------------------
-- A company raises blanket POs (company-wide or for one department) with a
-- value and a validity window. Every booking draws from one: the allocation
-- ledger records what each booking committed against which PO.
--
--   committed  booking is live (awaiting approval, with the venue, confirmed)
--   consumed   the event happened (completed, settled)
--   released   booking cancelled: the amount goes back to the PO
--
-- Balance = amount − committed − consumed. An allocation that would overdraw
-- its PO is refused unless it's flagged over_balance (the app then routes the
-- booking for sign-off). The check locks the PO row, so two concurrent bookings
-- can't both spend the last of a balance. Companies without POs are unaffected.
-- =============================================================================

create table if not exists public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.companies (id) on delete cascade,
  po_number      text not null check (length(trim(po_number)) between 1 and 40),
  description    text,
  -- null = company-wide; otherwise only that department's bookings draw from it.
  department_id  uuid references public.departments (id) on delete set null,
  amount_inr     numeric(14,2) not null check (amount_inr > 0),
  currency       char(3) not null default 'INR' check (currency = 'INR'),
  valid_from     date not null,
  valid_to       date not null,
  status         text not null default 'open' check (status in ('open', 'closed')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint purchase_orders_validity_check check (valid_to >= valid_from),
  constraint purchase_orders_number_key unique (tenant_id, po_number)
);

comment on table  public.purchase_orders is 'Blanket POs: a pre-approved spend envelope bookings draw from.';
comment on column public.purchase_orders.department_id is 'Null = company-wide; otherwise only that department''s bookings draw from it.';

create index if not exists purchase_orders_tenant_idx on public.purchase_orders (tenant_id, status);

create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

create table if not exists public.po_allocations (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references public.purchase_orders (id) on delete restrict,
  tenant_id     uuid not null references public.companies (id) on delete cascade,
  -- One allocation per booking; reallocating moves it to another PO.
  booking_id    uuid not null unique references public.bookings (id) on delete cascade,
  amount_inr    numeric(14,2) not null check (amount_inr >= 0),
  status        text not null default 'committed' check (status in ('committed', 'consumed', 'released')),
  -- Allowed past the PO's balance because the booking went through sign-off.
  over_balance  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.po_allocations is 'The PO ledger: what each booking draws from which purchase order.';

create index if not exists po_allocations_po_idx on public.po_allocations (po_id, status);

create trigger po_allocations_set_updated_at
  before update on public.po_allocations
  for each row execute function public.set_updated_at();

-- Same tenant, open PO, event inside its window, department match, and the balance.
create or replace function public.po_allocations_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  po        public.purchase_orders%rowtype;
  booking   public.bookings%rowtype;
  drawn     numeric(14,2);
begin
  if new.status = 'released' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.po_id = old.po_id and new.amount_inr <= old.amount_inr and old.status <> 'released' then
    return new; -- status moves within the same PO never draw more
  end if;

  -- Lock the PO so concurrent allocations see each other.
  select * into po from public.purchase_orders where id = new.po_id for update;
  select * into booking from public.bookings where id = new.booking_id;

  if po.tenant_id <> new.tenant_id or booking.company_id <> new.tenant_id then
    raise exception 'PO % belongs to another company', po.po_number using errcode = '42501';
  end if;
  if po.status <> 'open' then
    raise exception 'PO % is closed', po.po_number using errcode = '23514';
  end if;
  if booking.event_date not between po.valid_from and po.valid_to then
    raise exception 'PO % is not valid on %', po.po_number, booking.event_date using errcode = '23514';
  end if;
  if po.department_id is not null and booking.department_id is distinct from po.department_id then
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

create trigger po_allocations_check
  before insert or update on public.po_allocations
  for each row execute function public.po_allocations_check();

-- Allocations follow their booking (as inventory holds do).
create or replace function public.bookings_sync_po_allocations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.po_allocations
     set status = case
       when new.status = 'CANCELLED' then 'released'
       when new.status in ('COMPLETED', 'SETTLED') then 'consumed'
       else 'committed' end
   where booking_id = new.id;
  return new;
end;
$$;

create trigger bookings_sync_po_allocations
  after update of status on public.bookings
  for each row
  when (old.status is distinct from new.status)
  execute function public.bookings_sync_po_allocations();

-- Row Level Security -------------------------------------------------------------------------
alter table public.purchase_orders enable row level security;
alter table public.po_allocations  enable row level security;

create policy "admins manage purchase orders"
  on public.purchase_orders for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "tenant users read own purchase orders"
  on public.purchase_orders for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "admins manage po allocations"
  on public.po_allocations for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy "tenant users read own po allocations"
  on public.po_allocations for select to authenticated
  using (tenant_id = (select public.current_company_id()));
