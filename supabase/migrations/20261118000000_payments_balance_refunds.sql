-- =============================================================================
-- Payments: balance after the event, refunds; bills: refund vouchers, PDF data
-- -----------------------------------------------------------------------------
-- 1. payments.purpose: what a payment is for. Until now a booking payment
--    without an instalment was always the pre-confirmation deposit. The
--    balance on the tax invoice can now be paid online too, so the two are
--    told apart: one live deposit and one live balance payment per booking.
-- 2. payments.refunded_inr + payment_refunds: refunds sent through the payment
--    provider (in full or in part), one row per refund. A payment is
--    'refunded' once all of it has gone back; a part refund leaves it
--    'captured' with refunded_inr > 0.
-- 3. refund_vouchers + refund_voucher_series: the GST refund voucher for a
--    deposit returned before any invoice, 'RFV/2026-27/000001' per venue per FY.
-- 4. tax_invoice_documents.data / receipt_vouchers.data: the document as
--    structured text, so the PDF is made from exactly what was issued.
-- Writes go through the service role only.
-- =============================================================================

-- 1 · Purpose ------------------------------------------------------------------------------
alter table public.payments
  add column if not exists purpose text not null default 'deposit'
    check (purpose in ('deposit', 'balance', 'instalment', 'order'));

update public.payments set purpose = 'instalment' where booking_invoice_id is not null and purpose = 'deposit';
update public.payments set purpose = 'order' where catalog_order_id is not null and purpose = 'deposit';

comment on column public.payments.purpose is 'deposit: before the venue confirms (authorised, captured on confirmation). balance: against the issued tax invoice. instalment: a contract invoice. order: a catalogue order.';

drop index if exists public.payments_one_live_per_booking;
create unique index if not exists payments_one_live_per_booking
  on public.payments (booking_id) where status in ('authorized', 'captured') and purpose = 'deposit' and booking_invoice_id is null;
create unique index if not exists payments_one_live_balance_per_booking
  on public.payments (booking_id) where status in ('authorized', 'captured') and purpose = 'balance';

-- 2 · Refunds ------------------------------------------------------------------------------
alter table public.payments
  add column if not exists refunded_inr numeric(14,2) not null default 0,
  add column if not exists refunded_at  timestamptz;

alter table public.payments drop constraint if exists payments_refunded_check;
alter table public.payments add constraint payments_refunded_check check (refunded_inr >= 0 and refunded_inr <= amount_inr);

create table if not exists public.payment_refunds (
  id                  uuid primary key default gen_random_uuid(),
  payment_id          uuid not null references public.payments (id) on delete cascade,
  -- Razorpay rfnd_… / Stripe re_… (null until the provider answers)
  provider_refund_id  text,
  amount_inr          numeric(14,2) not null check (amount_inr > 0),
  status              text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  reason              text check (reason is null or char_length(reason) <= 500),
  -- Null: made outside the app (the provider's dashboard) and learnt from a webhook.
  created_by          uuid references auth.users (id) on delete set null,
  error               text,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz,
  constraint payment_refunds_provider_key unique (payment_id, provider_refund_id)
);

comment on table public.payment_refunds is 'Refunds of captured payments, one row each. Service role writes.';
create index if not exists payment_refunds_payment_idx on public.payment_refunds (payment_id);

alter table public.payment_refunds enable row level security;

drop policy if exists "admins read payment refunds" on public.payment_refunds;
create policy "admins read payment refunds"
  on public.payment_refunds for select to authenticated
  using ((select public.is_platform_admin()));

-- 3 · Refund vouchers ------------------------------------------------------------------------
create table if not exists public.refund_voucher_series (
  venue_id     uuid not null references public.venues (id) on delete cascade,
  fiscal_year  text not null check (fiscal_year ~ '^\d{4}-\d{2}$'),
  last_number  integer not null default 0 check (last_number >= 0),
  primary key (venue_id, fiscal_year)
);

comment on table public.refund_voucher_series is 'Consecutive refund voucher serials per supplier (venue) per Indian FY.';

create table if not exists public.refund_vouchers (
  refund_id       uuid primary key references public.payment_refunds (id) on delete cascade,
  booking_id      uuid not null references public.bookings (id) on delete cascade,
  tenant_id       uuid not null references public.companies (id) on delete cascade,
  venue_id        uuid not null references public.venues (id) on delete cascade,
  voucher_number  text not null,
  issued_on       date not null,
  amount_inr      numeric(14,2) not null check (amount_inr > 0),
  html            text not null,
  html_sha256     text not null check (html_sha256 ~ '^[0-9a-f]{64}$'),
  data            jsonb,
  created_at      timestamptz not null default now(),
  constraint refund_vouchers_number_key unique (venue_id, voucher_number)
);

comment on table public.refund_vouchers is 'Refund voucher for a deposit returned before any tax invoice (GST refund voucher), rendered once.';
create index if not exists refund_vouchers_booking_idx on public.refund_vouchers (booking_id);

create or replace function public.take_refund_voucher_number(p_venue_id uuid, p_on date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fy text := public.indian_fiscal_year(p_on);
  n  integer;
begin
  insert into public.refund_voucher_series as s (venue_id, fiscal_year, last_number)
  values (p_venue_id, fy, 1)
  on conflict (venue_id, fiscal_year) do update set last_number = s.last_number + 1
  returning last_number into n;
  return 'RFV/' || fy || '/' || lpad(n::text, 6, '0');
end;
$$;

revoke all on function public.take_refund_voucher_number(uuid, date) from public, anon, authenticated;
grant execute on function public.take_refund_voucher_number(uuid, date) to service_role;

alter table public.refund_voucher_series enable row level security;
alter table public.refund_vouchers       enable row level security;

drop policy if exists "admins read refund vouchers" on public.refund_vouchers;
create policy "admins read refund vouchers"
  on public.refund_vouchers for select to authenticated
  using ((select public.is_platform_admin()));

drop policy if exists "tenant users read own refund vouchers" on public.refund_vouchers;
create policy "tenant users read own refund vouchers"
  on public.refund_vouchers for select to authenticated
  using (tenant_id = (select public.current_company_id()));

-- 4 · Document data for PDFs -----------------------------------------------------------------
alter table public.tax_invoice_documents add column if not exists data jsonb;
alter table public.receipt_vouchers      add column if not exists data jsonb;

comment on column public.tax_invoice_documents.data is 'The issued invoice as structured text (lib/finance/tax-invoice-document.ts BillDocument); the PDF is made from it.';
