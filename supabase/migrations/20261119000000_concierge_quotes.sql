-- =============================================================================
-- Concierge quotes: a price on a request, accepted and paid in the app
-- -----------------------------------------------------------------------------
-- Until now a concierge request (a quote on a listing Lufer arranges by hand,
-- or an event brief) carried only a status and a note; the price went by email
-- and nothing could be paid. Now:
--
-- 1. Lufer answers a request with a quote: the venue, date, guests and the
--    total the company pays, all taxes and charges included (status 'quoted').
-- 2. The company accepts it in the app (status 'booked', accepted_at/by).
-- 3. The company pays that total through the payment provider. The payment
--    hangs off the request (payments.concierge_request_id, purpose 'request'):
--    these venues have no account or GSTIN here, so there is no booking row
--    and no tax invoice from Lufer's books; the company gets a payment receipt.
-- Writes go through the service role only.
-- =============================================================================

alter table public.concierge_requests
  add column if not exists quote_total_inr numeric(14,2) check (quote_total_inr is null or quote_total_inr > 0),
  add column if not exists quote_note      text check (quote_note is null or char_length(quote_note) <= 500),
  add column if not exists quoted_at       timestamptz,
  add column if not exists accepted_at     timestamptz,
  add column if not exists accepted_by     uuid references auth.users (id) on delete set null;

comment on column public.concierge_requests.quote_total_inr is 'What the company pays for the event, all taxes and charges included, as quoted by Lufer for the venue.';
comment on column public.concierge_requests.quote_note is 'What the quote covers, in one line ("₹2,000 a head, 5% GST and service charge included").';

alter table public.concierge_requests drop constraint if exists concierge_requests_status_check;
alter table public.concierge_requests add constraint concierge_requests_status_check
  check (status in ('new', 'working', 'options_sent', 'quoted', 'booked', 'closed'));

-- A quote names what is being bought: the venue, the day, the guests and the price.
alter table public.concierge_requests drop constraint if exists concierge_requests_quote_complete;
alter table public.concierge_requests add constraint concierge_requests_quote_complete
  check (status <> 'quoted' or (quote_total_inr is not null and venue_name is not null and event_date is not null and guests is not null));

-- Payments: a third thing a payment can be for.
alter table public.payments
  add column if not exists concierge_request_id uuid references public.concierge_requests (id) on delete restrict;

alter table public.payments drop constraint if exists payments_subject_check;
alter table public.payments add constraint payments_subject_check
  check (num_nonnulls(booking_id, catalog_order_id, concierge_request_id) = 1);

alter table public.payments drop constraint if exists payments_purpose_check;
alter table public.payments add constraint payments_purpose_check
  check (purpose in ('deposit', 'balance', 'instalment', 'order', 'request'));

create unique index if not exists payments_one_live_per_request
  on public.payments (concierge_request_id) where status in ('authorized', 'captured');
create index if not exists payments_request_idx on public.payments (concierge_request_id) where concierge_request_id is not null;

drop policy if exists "clients read own request payments" on public.payments;
create policy "clients read own request payments"
  on public.payments for select to authenticated
  using (
    concierge_request_id is not null
    and exists (
      select 1 from public.concierge_requests r
      where r.id = payments.concierge_request_id and r.company_id = (select public.current_company_id())
    )
  );
