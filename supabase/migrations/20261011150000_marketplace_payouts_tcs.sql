-- =============================================================================
-- 0023 · Marketplace settlement: stock, order payments, Route payouts, TCS
-- -----------------------------------------------------------------------------
-- The partner stays the supplier of record on catalogue invoices; the platform
-- collects the buyer's payment as an e-commerce operator and settles with the
-- partner through Razorpay Route:
--
--   buyer pays invoice total ──► platform (payments, manual capture)
--   supplier confirms        ──► capture; Route transfer to the partner's linked
--                                account, ON HOLD (vendor_payouts)
--   order delivered          ──► hold released; Razorpay settles to the partner
--   order cancelled          ──► authorisation lapses, or refund + transfer reversal
--
-- The transfer is the invoice total less the platform's commission, GST on that
-- commission (the platform's own supply to the partner), and TCS under Section 52
-- of the CGST Act (0.5% of the net taxable value since 10 July 2024: 0.25% CGST +
-- 0.25% SGST intra-state, 0.5% IGST inter-state). tcs_entries is the GSTR-8
-- ledger: one collection per order, and a negative reversal when a supply is
-- returned (cancelled after capture), each in the month it happened.
-- Rules and arithmetic: lib/marketplace/settlement.ts.
-- =============================================================================

-- 1 · Stock -------------------------------------------------------------------------------------
alter table public.catalog_items
  add column if not exists stock_quantity integer check (stock_quantity is null or stock_quantity >= 0);

comment on column public.catalog_items.stock_quantity is 'Units left to sell; null = not tracked (made to order, services). Reserved when an order is placed, returned when it is cancelled.';

create or replace function public.catalog_orders_reserve_stock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tracked boolean;
begin
  if tg_op = 'INSERT' then
    update public.catalog_items
       set stock_quantity = stock_quantity - new.quantity
     where id = new.item_id and stock_quantity is not null and stock_quantity >= new.quantity;
    if not found then
      select stock_quantity is not null into tracked from public.catalog_items where id = new.item_id;
      if tracked then
        raise exception 'Only % left of this item', (select stock_quantity from public.catalog_items where id = new.item_id)
          using errcode = '23514', hint = 'stock';
      end if;
    end if;
  elsif new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
    update public.catalog_items set stock_quantity = stock_quantity + old.quantity
     where id = new.item_id and stock_quantity is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists catalog_orders_reserve_stock on public.catalog_orders;
create trigger catalog_orders_reserve_stock
  after insert or update of status on public.catalog_orders
  for each row execute function public.catalog_orders_reserve_stock();

-- 2 · Partner settlement terms and Route linked account ------------------------------------------
alter table public.partners
  add column if not exists commission_rate numeric(5,4) not null default 0.1000
    check (commission_rate >= 0 and commission_rate <= 0.5),
  -- Razorpay Route linked account (acc_…), created and KYC'd in Razorpay; set by admins.
  add column if not exists razorpay_account_id text unique
    check (razorpay_account_id is null or razorpay_account_id ~ '^acc_[A-Za-z0-9]{14}$');

comment on column public.partners.commission_rate is 'Platform commission on catalogue orders (0.10 = 10% of the taxable value).';

alter table public.catalog_orders
  add column if not exists commission_rate numeric(5,4) check (commission_rate >= 0 and commission_rate <= 0.5);

comment on column public.catalog_orders.commission_rate is 'Partner commission rate when the order was placed. Trigger-set; later rate changes never rewrite settled orders.';

create or replace function public.catalog_orders_snapshot_commission()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select p.commission_rate into new.commission_rate from public.partners p where p.id = new.partner_id;
  return new;
end;
$$;

drop trigger if exists catalog_orders_snapshot_commission on public.catalog_orders;
create trigger catalog_orders_snapshot_commission
  before insert on public.catalog_orders
  for each row execute function public.catalog_orders_snapshot_commission();

update public.catalog_orders o set commission_rate = p.commission_rate
  from public.partners p where p.id = o.partner_id and o.commission_rate is null;

-- 3 · Payments: a booking deposit or a catalogue order -------------------------------------------
alter table public.payments
  alter column booking_id drop not null,
  add column if not exists catalog_order_id uuid references public.catalog_orders (id) on delete restrict,
  add constraint payments_subject_check check ((booking_id is null) <> (catalog_order_id is null));

create unique index if not exists payments_one_live_per_order
  on public.payments (catalog_order_id) where status in ('authorized', 'captured');
create index if not exists payments_order_idx on public.payments (catalog_order_id) where catalog_order_id is not null;

create policy "clients read own order payments"
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.catalog_orders o
    where o.id = payments.catalog_order_id and o.tenant_id = (select public.current_company_id())
  ));

create policy "partners read payments for own orders"
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.catalog_orders o
    where o.id = payments.catalog_order_id and o.partner_id = (select public.current_partner_id())
  ));

-- 4 · Vendor payouts (one Route transfer per order) ----------------------------------------------
create table if not exists public.vendor_payouts (
  id                    uuid primary key default gen_random_uuid(),
  catalog_order_id      uuid not null unique references public.catalog_orders (id) on delete restrict,
  partner_id            uuid not null references public.partners (id) on delete restrict,
  payment_id            uuid not null references public.payments (id) on delete restrict,
  linked_account_id     text not null,
  provider_transfer_id  text unique,
  -- What the buyer paid (invoice total incl. GST) and its taxable value.
  gross_inr             numeric(14,2) not null check (gross_inr >= 0),
  taxable_inr           numeric(14,2) not null check (taxable_inr >= 0),
  commission_rate       numeric(5,4) not null,
  commission_inr        numeric(14,2) not null check (commission_inr >= 0),
  commission_gst_inr    numeric(14,2) not null check (commission_gst_inr >= 0),
  tcs_rate_bps          smallint not null check (tcs_rate_bps between 0 and 100),
  tcs_inr               numeric(14,2) not null check (tcs_inr >= 0),
  net_payout_inr        numeric(14,2) not null check (net_payout_inr >= 0),
  -- pending: claimed, transfer not created yet · on_hold: transferred, held until delivery ·
  -- released: hold lifted, settling · settled: in the partner's bank · reversed: refunded ·
  -- failed: Razorpay rejected the transfer (see last_error)
  status                text not null default 'pending'
                          check (status in ('pending', 'on_hold', 'released', 'settled', 'reversed', 'failed')),
  last_error            text,
  released_at           timestamptz,
  settled_at            timestamptz,
  reversed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint vendor_payouts_net_check check (net_payout_inr = gross_inr - commission_inr - commission_gst_inr - tcs_inr)
);

comment on table public.vendor_payouts is 'Razorpay Route transfer per catalogue order: invoice total less commission, GST on commission and Section 52 TCS.';

create index if not exists vendor_payouts_partner_idx on public.vendor_payouts (partner_id, created_at desc);

create trigger vendor_payouts_set_updated_at
  before update on public.vendor_payouts
  for each row execute function public.set_updated_at();

-- 5 · TCS ledger (GSTR-8) -----------------------------------------------------------------------
create table if not exists public.tcs_entries (
  id                uuid primary key default gen_random_uuid(),
  catalog_order_id  uuid not null references public.catalog_orders (id) on delete restrict,
  partner_id        uuid not null references public.partners (id) on delete restrict,
  supplier_gstin    char(15) not null check (public.is_valid_gstin(supplier_gstin)),
  place_of_supply   char(2) not null,
  -- The month the collection (or return) happened: the GSTR-8 period it's reported in.
  return_period     char(7) not null check (return_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind              text not null check (kind in ('collection', 'reversal')),
  -- Signed: collections positive, reversals negative.
  taxable_inr       numeric(14,2) not null,
  rate_bps          smallint not null check (rate_bps between 0 and 100),
  cgst_inr          numeric(14,2) not null default 0,
  sgst_inr          numeric(14,2) not null default 0,
  igst_inr          numeric(14,2) not null default 0,
  created_at        timestamptz not null default now(),
  unique (catalog_order_id, kind),
  constraint tcs_entries_sign_check check (
    case kind when 'collection' then taxable_inr >= 0 and cgst_inr >= 0 and sgst_inr >= 0 and igst_inr >= 0
              else taxable_inr <= 0 and cgst_inr <= 0 and sgst_inr <= 0 and igst_inr <= 0 end
  ),
  -- A supply is intra-state (CGST + SGST) or inter-state (IGST), never both.
  constraint tcs_entries_heads_check check (igst_inr = 0 or (cgst_inr = 0 and sgst_inr = 0))
);

comment on table public.tcs_entries is 'Section 52 TCS collected on partner supplies (and reversed on returns), by GSTR-8 return period.';

create index if not exists tcs_entries_period_idx on public.tcs_entries (return_period, supplier_gstin);

-- GSTR-8 table 3 shape: per period × supplier × place of supply.
create or replace view public.tcs_gstr8_summary
with (security_invoker = true) as
select
  return_period,
  supplier_gstin,
  place_of_supply,
  sum(taxable_inr) filter (where kind = 'collection')            as gross_supplies_inr,
  coalesce(-sum(taxable_inr) filter (where kind = 'reversal'), 0) as supplies_returned_inr,
  sum(taxable_inr)                                                as net_taxable_inr,
  sum(igst_inr)                                                   as igst_inr,
  sum(cgst_inr)                                                   as cgst_inr,
  sum(sgst_inr)                                                   as sgst_inr
from public.tcs_entries
group by return_period, supplier_gstin, place_of_supply;

-- 6 · Row Level Security -----------------------------------------------------------------------
-- The app writes through the service role; these are read policies.
alter table public.vendor_payouts enable row level security;
alter table public.tcs_entries    enable row level security;

create policy "admins read vendor payouts"
  on public.vendor_payouts for select to authenticated
  using ((select public.is_platform_admin()));

create policy "partners read own payouts"
  on public.vendor_payouts for select to authenticated
  using (partner_id = (select public.current_partner_id()));

create policy "admins read tcs entries"
  on public.tcs_entries for select to authenticated
  using ((select public.is_platform_admin()));

-- Partners reconcile the TCS credit they see in their GSTR-2X against this.
create policy "partners read own tcs entries"
  on public.tcs_entries for select to authenticated
  using (partner_id = (select public.current_partner_id()));
