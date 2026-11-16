-- =============================================================================
-- Billing on completion: numbered tax invoices, deposit receipt vouchers,
-- company billing address
-- -----------------------------------------------------------------------------
-- A booking's tax invoice (tax_invoice_documents) used to be rendered when the
-- venue confirmed, unnumbered and dated the event. Now it's issued once the
-- event has happened (venue marks it complete, or the date has passed while
-- confirmed), dated that day and numbered in the supplier's FY series, with any
-- deposit already received set against it. A deposit taken before then gets a
-- receipt voucher (GST on an advance for services), also numbered.
--
-- Supplier today: the venue (its GSTIN, address and series), the marketplace
-- model the app already uses. If Lufer becomes the supplier instead, the
-- series and supplier block change; the documents and flow stay.
--
-- 1. companies.billing_address: the "Bill to" address on invoices (the state
--    comes from the GSTIN). Invoices wait until it's set.
-- 2. take_venue_invoice_number(): the next serial in invoice_number_series,
--    shared with contract instalment invoices so a venue's series stays
--    consecutive. Format as before: '2026-27/000001'.
-- 3. receipt_vouchers + receipt_voucher_series: one voucher per captured
--    deposit, 'RV/2026-27/000001' in the venue's voucher series.
-- 4. tax_invoice_documents.issued_on / advance_inr / receipt_voucher_number:
--    what the issued invoice says.
-- Writes go through the service role only; companies and venues read their own
-- documents through the app (it checks who may open them).
-- =============================================================================

-- 1 · Billing address ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists billing_address text check (billing_address is null or char_length(trim(billing_address)) between 10 and 500);

comment on column public.companies.billing_address is 'Registered/billing address printed under "Bill to" on tax invoices (street, city, PIN). Null: not given yet; invoices wait for it.';

-- 2 · Invoice numbers ---------------------------------------------------------------------------
create or replace function public.take_venue_invoice_number(p_venue_id uuid, p_on date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fy text := public.indian_fiscal_year(p_on);
  n  integer;
begin
  insert into public.invoice_number_series as s (venue_id, fiscal_year, last_number)
  values (p_venue_id, fy, 1)
  on conflict (venue_id, fiscal_year) do update set last_number = s.last_number + 1
  returning last_number into n;
  return fy || '/' || lpad(n::text, 6, '0');
end;
$$;

comment on function public.take_venue_invoice_number(uuid, date) is 'Next tax invoice serial in the venue''s FY series (shared with booking_invoices).';
revoke all on function public.take_venue_invoice_number(uuid, date) from public, anon, authenticated;
grant execute on function public.take_venue_invoice_number(uuid, date) to service_role;

alter table public.tax_invoice_documents
  add column if not exists issued_on              date,
  add column if not exists advance_inr            numeric(14,2) not null default 0 check (advance_inr >= 0),
  add column if not exists receipt_voucher_number text;

comment on column public.tax_invoice_documents.issued_on is 'Invoice date (IST), the day it was issued after the event.';
comment on column public.tax_invoice_documents.advance_inr is 'Deposit already received against this invoice (its receipt voucher).';

-- 3 · Receipt vouchers for deposits ------------------------------------------------------------
create table if not exists public.receipt_voucher_series (
  venue_id     uuid not null references public.venues (id) on delete cascade,
  fiscal_year  text not null check (fiscal_year ~ '^\d{4}-\d{2}$'),
  last_number  integer not null default 0 check (last_number >= 0),
  primary key (venue_id, fiscal_year)
);

comment on table public.receipt_voucher_series is 'Consecutive receipt voucher serials per supplier (venue) per Indian FY.';

create table if not exists public.receipt_vouchers (
  payment_id      uuid primary key references public.payments (id) on delete cascade,
  booking_id      uuid not null references public.bookings (id) on delete cascade,
  tenant_id       uuid not null references public.companies (id) on delete cascade,
  venue_id        uuid not null references public.venues (id) on delete cascade,
  voucher_number  text not null,
  issued_on       date not null,
  amount_inr      numeric(14,2) not null check (amount_inr > 0),
  html            text not null,
  html_sha256     text not null check (html_sha256 ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  constraint receipt_vouchers_number_key unique (venue_id, voucher_number)
);

comment on table public.receipt_vouchers is 'Receipt voucher for a deposit received before the event (GST on advances), rendered once.';

create index if not exists receipt_vouchers_booking_idx on public.receipt_vouchers (booking_id);

create or replace function public.take_receipt_voucher_number(p_venue_id uuid, p_on date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fy text := public.indian_fiscal_year(p_on);
  n  integer;
begin
  insert into public.receipt_voucher_series as s (venue_id, fiscal_year, last_number)
  values (p_venue_id, fy, 1)
  on conflict (venue_id, fiscal_year) do update set last_number = s.last_number + 1
  returning last_number into n;
  return 'RV/' || fy || '/' || lpad(n::text, 6, '0');
end;
$$;

revoke all on function public.take_receipt_voucher_number(uuid, date) from public, anon, authenticated;
grant execute on function public.take_receipt_voucher_number(uuid, date) to service_role;

alter table public.receipt_voucher_series enable row level security;
alter table public.receipt_vouchers       enable row level security;

drop policy if exists "admins read receipt vouchers" on public.receipt_vouchers;
create policy "admins read receipt vouchers"
  on public.receipt_vouchers for select to authenticated
  using ((select public.is_platform_admin()));

drop policy if exists "tenant users read own receipt vouchers" on public.receipt_vouchers;
create policy "tenant users read own receipt vouchers"
  on public.receipt_vouchers for select to authenticated
  using (tenant_id = (select public.current_company_id()));
