-- =============================================================================
-- 0011 · Payments, menu packages, RFP broadcast, booking pricing snapshot
-- -----------------------------------------------------------------------------
-- Builds on 0010 (inventory_holds + corporate_rate_cards):
-- - payments / payment_events: deposit authorisations (Razorpay or Stripe),
--   captured when the venue confirms, voided on decline. Events dedupe webhooks.
-- - venue_menu_packages: per-head menus with dietary tags (edited by hosts,
--   optionally via the AI negotiator).
-- - rfps / rfp_responses: one brief broadcast to many venues; each venue gets an
--   instant quote (menu package + corporate rate card + minimum spend) and may
--   counter from the property portal.
-- - bookings record the list per-head price and the rate card applied, so savings
--   stay reportable after createBookingRequest stores the negotiated price.
-- =============================================================================

do $$ begin
  create type public.payment_provider as enum ('razorpay', 'stripe');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('created', 'authorized', 'captured', 'voided', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rfp_status as enum ('open', 'awarded', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rfp_response_source as enum ('instant', 'venue');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rfp_response_status as enum ('quoted', 'countered', 'declined', 'no_fit');
exception when duplicate_object then null; end $$;

-- 1 · Menu packages -----------------------------------------------------------------
create table if not exists public.venue_menu_packages (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  per_head_inr  numeric(14,2) not null check (per_head_inr > 0),
  dietary_tags  text[] not null default '{}'
                  check (dietary_tags <@ array['vegetarian','vegan','jain','halal','gluten_free','nut_free','eggless']::text[]),
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint venue_menu_packages_venue_name_key unique (venue_id, name)
);

create trigger venue_menu_packages_set_updated_at
  before update on public.venue_menu_packages
  for each row execute function public.set_updated_at();

-- 2 · Payments ----------------------------------------------------------------------
create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid not null references public.bookings (id) on delete restrict,
  provider             public.payment_provider not null,
  status               public.payment_status not null default 'created',
  amount_inr           numeric(14,2) not null check (amount_inr > 0),
  deposit_rate         numeric(5,4) not null check (deposit_rate > 0 and deposit_rate <= 1),
  currency             char(3) not null default 'INR',
  -- Razorpay order_… / Stripe Checkout Session cs_…
  provider_order_id    text not null,
  -- Razorpay pay_… / Stripe PaymentIntent pi_… (known once the client pays)
  provider_payment_id  text,
  -- GST invoice snapshot (lib/gst-engine TaxInvoicePayload + discount + deposit).
  invoice              jsonb not null,
  last_error           text,
  authorized_at        timestamptz,
  captured_at          timestamptz,
  voided_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint payments_provider_order_key unique (provider, provider_order_id)
);

-- One live deposit per booking.
create unique index if not exists payments_one_live_per_booking
  on public.payments (booking_id) where status in ('authorized', 'captured');
create index if not exists payments_booking_idx on public.payments (booking_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create table if not exists public.payment_events (
  provider     public.payment_provider not null,
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);

comment on table public.payment_events is 'Processed provider webhooks, for idempotency. Service role only.';

-- 3 · RFPs --------------------------------------------------------------------------
create table if not exists public.rfps (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  created_by           uuid references auth.users (id) on delete set null,
  brief                text not null check (length(trim(brief)) > 0),
  -- Structured requirements extracted from the brief by the model.
  requirements         jsonb not null,
  event_date           date,
  party_size           integer not null check (party_size > 0),
  budget_per_head_inr  numeric(14,2) check (budget_per_head_inr >= 0),
  city                 text,
  dietary_tags         text[] not null default '{}',
  status               public.rfp_status not null default 'open',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists rfps_company_idx on public.rfps (company_id, created_at desc);

create trigger rfps_set_updated_at
  before update on public.rfps
  for each row execute function public.set_updated_at();

create table if not exists public.rfp_responses (
  id                  uuid primary key default gen_random_uuid(),
  rfp_id              uuid not null references public.rfps (id) on delete cascade,
  venue_id            uuid not null references public.venues (id) on delete cascade,
  source              public.rfp_response_source not null default 'instant',
  status              public.rfp_response_status not null,
  menu_package_id     uuid references public.venue_menu_packages (id) on delete set null,
  per_head_inr        numeric(14,2) check (per_head_inr >= 0),
  -- Pricing snapshot: list = party × per-head before the rate card; taxable is what
  -- the client would pay pre-GST (rate card + minimum spend applied). GST is derived
  -- from taxable_amount_inr via lib/gst-engine.
  list_amount_inr     numeric(14,2) check (list_amount_inr >= 0),
  -- The client's corporate_rate_cards row applied to the instant quote, if any.
  rate_card_id        uuid references public.corporate_rate_cards (id) on delete set null,
  taxable_amount_inr  numeric(14,2) check (taxable_amount_inr >= 0),
  notes               text,
  responded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint rfp_responses_rfp_venue_key unique (rfp_id, venue_id)
);

create index if not exists rfp_responses_venue_idx on public.rfp_responses (venue_id, created_at desc);

create trigger rfp_responses_set_updated_at
  before update on public.rfp_responses
  for each row execute function public.set_updated_at();

-- 4 · Booking pricing snapshot ---------------------------------------------------------
alter table public.bookings
  add column if not exists list_budget_per_head_inr numeric(14,2) check (list_budget_per_head_inr >= 0),
  add column if not exists rate_card_id uuid references public.corporate_rate_cards (id) on delete set null;

comment on column public.bookings.list_budget_per_head_inr is
  'Per-head price before the corporate rate card (null = list price, no card). budget_per_head_inr is the negotiated price.';
comment on column public.bookings.rate_card_id is 'corporate_rate_cards row applied when the booking was priced.';

-- 5 · RLS ---------------------------------------------------------------------------
-- Writes go through server code (service role) after requirePortal() checks; portal
-- users get read access scoped to their company / venue.
alter table public.venue_menu_packages enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_events      enable row level security;
alter table public.rfps                enable row level security;
alter table public.rfp_responses       enable row level security;

create policy "admins manage menu packages"
  on public.venue_menu_packages for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "property manages own menu packages"
  on public.venue_menu_packages for all to authenticated
  using (venue_id = public.current_venue_id()) with check (venue_id = public.current_venue_id());

create policy "authenticated read active menu packages"
  on public.venue_menu_packages for select to authenticated
  using (is_active);

create policy "admins read payments"
  on public.payments for select to authenticated
  using (public.is_platform_admin());

create policy "clients read own payments"
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = payments.booking_id and b.company_id = public.current_company_id()
  ));

create policy "property reads own payments"
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = payments.booking_id and b.venue_id = public.current_venue_id()
  ));

-- payment_events: no policies → service role only.

-- rfps ↔ rfp_responses policies reference each other; these SECURITY DEFINER
-- helpers read across without re-entering RLS (avoids policy recursion).
create or replace function public.rfp_company_id(p_rfp_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select company_id from public.rfps where id = p_rfp_id $$;

create or replace function public.rfp_sent_to_current_venue(p_rfp_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.rfp_responses
    where rfp_id = p_rfp_id and venue_id = public.current_venue_id()
  )
$$;

create policy "admins manage rfps"
  on public.rfps for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "clients read own rfps"
  on public.rfps for select to authenticated
  using (company_id = public.current_company_id());

create policy "property reads rfps sent to it"
  on public.rfps for select to authenticated
  using (public.rfp_sent_to_current_venue(id));

create policy "admins manage rfp responses"
  on public.rfp_responses for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "clients read responses to own rfps"
  on public.rfp_responses for select to authenticated
  using (public.rfp_company_id(rfp_id) = public.current_company_id());

create policy "property reads own rfp responses"
  on public.rfp_responses for select to authenticated
  using (venue_id = public.current_venue_id());
