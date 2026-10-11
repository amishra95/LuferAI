-- =============================================================================
-- 0025 · Venue host controls: blocked dates, negotiation guardrails, direct quotes
-- -----------------------------------------------------------------------------
-- venue_blocked_dates        Dates a host marks unavailable (maintenance, private
--                            hire off-platform). They lock the date like a hold or a
--                            confirmed booking: the availability check
--                            (lib/inventory/venue-locks.ts) and so the client date
--                            picker and booking placement refuse them.
-- venue_negotiation_rules    One row per venue: a minimum spend floor and a maximum
--                            discount, enforced on counters, direct quotes and the AI
--                            negotiator's proposals; optional auto-counter and
--                            auto-decline when an RFP is broadcast
--                            (lib/rfp/guardrails.ts).
-- rfps.origin                'venue' for a direct quote: the venue opens the RFP for a
--                            client company with its own response already priced.
-- rfps.booking_id            The booking an accepted quote became (status 'awarded').
--
-- The app writes through the service role; venue managers read their own rows and
-- admins read all.
-- =============================================================================

create table if not exists public.venue_blocked_dates (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues (id) on delete cascade,
  blocked_date  date not null,
  reason        text check (reason is null or char_length(btrim(reason)) between 1 and 120),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint venue_blocked_dates_venue_date_key unique (venue_id, blocked_date)
);

create index if not exists venue_blocked_dates_venue_idx on public.venue_blocked_dates (venue_id, blocked_date);

create table if not exists public.venue_negotiation_rules (
  venue_id                  uuid primary key references public.venues (id) on delete cascade,
  -- Pre-GST total a counter or quote may not go below; null = no floor.
  min_spend_floor_inr       numeric(14,2) check (min_spend_floor_inr is null or min_spend_floor_inr >= 0),
  -- Largest discount off the venue's own price (instant quote or package); null = no cap.
  max_discount_pct          numeric(5,2) check (max_discount_pct is null or (max_discount_pct >= 0 and max_discount_pct <= 90)),
  -- Counter RFPs whose budget is within the discount automatically, at the lowest allowed price.
  auto_counter              boolean not null default false,
  -- Decline RFPs that can't reach the floor automatically.
  auto_decline_below_floor  boolean not null default false,
  updated_by                uuid references auth.users (id) on delete set null,
  updated_at                timestamptz not null default now()
);

drop trigger if exists venue_negotiation_rules_set_updated_at on public.venue_negotiation_rules;
create trigger venue_negotiation_rules_set_updated_at
  before update on public.venue_negotiation_rules
  for each row execute function public.set_updated_at();

alter table public.rfps
  add column if not exists origin text not null default 'client' check (origin in ('client', 'venue')),
  add column if not exists booking_id uuid references public.bookings (id) on delete set null;

alter table public.venue_blocked_dates     enable row level security;
alter table public.venue_negotiation_rules enable row level security;

create policy "admins read blocked dates"
  on public.venue_blocked_dates for select to authenticated
  using ((select public.is_platform_admin()));

create policy "venues read own blocked dates"
  on public.venue_blocked_dates for select to authenticated
  using (venue_id = (select public.current_venue_id()));

create policy "admins read negotiation rules"
  on public.venue_negotiation_rules for select to authenticated
  using ((select public.is_platform_admin()));

create policy "venues read own negotiation rules"
  on public.venue_negotiation_rules for select to authenticated
  using (venue_id = (select public.current_venue_id()));
