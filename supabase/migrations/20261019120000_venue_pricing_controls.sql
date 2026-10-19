-- =============================================================================
-- 0027 · Venue pricing controls: guest-count tiers, rate calendar, deposit, AI locks
-- -----------------------------------------------------------------------------
-- venue_pricing_rules   One row per venue, edited by the host on /property → Pricing
--                       and applied wherever the platform prices the venue for a
--                       date and party size (lib/rates/venue-pricing.ts):
--   deposit_pct          Share of the GST-inclusive total authorised as the deposit,
--                        1–100% (payments.deposit_rate must be positive); null = the
--                        platform default (lib/quotes.ts DEPOSIT_RATE).
--   guest_tiers          [{ min_guests, max_guests | null, adjustment_pct }]: per-head
--                        adjustment for a party-size band (−5 = 5% off packages).
--   rate_multipliers     [{ id, kind, label, weekdays, starts_on, ends_on, multiplier }]:
--                        weekend surcharges (by weekday), peak seasons and
--                        high-demand dates (by date range). The largest one in force
--                        on the event date applies; they don't compound.
--   lock_min_spend       The AI negotiator may not change venues.min_spend_inr.
--   locked_package_ids   Menu packages the AI negotiator may not change.
--
-- The JSON lists are validated by the app and parsed defensively on read, like the
-- venue profile columns (migration 0019). Minimum spend, the per-guest minimum
-- and cancellation tiers stay on venues; packages on venue_menu_packages.
--
-- The app writes through the service role; venue managers read their own row and
-- admins read all.
-- =============================================================================

create table if not exists public.venue_pricing_rules (
  venue_id            uuid primary key references public.venues (id) on delete cascade,
  deposit_pct         numeric(5,2) check (deposit_pct is null or (deposit_pct >= 1 and deposit_pct <= 100)),
  guest_tiers         jsonb not null default '[]'::jsonb check (jsonb_typeof(guest_tiers) = 'array'),
  rate_multipliers    jsonb not null default '[]'::jsonb check (jsonb_typeof(rate_multipliers) = 'array'),
  lock_min_spend      boolean not null default false,
  locked_package_ids  uuid[] not null default '{}',
  updated_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now()
);

drop trigger if exists venue_pricing_rules_set_updated_at on public.venue_pricing_rules;
create trigger venue_pricing_rules_set_updated_at
  before update on public.venue_pricing_rules
  for each row execute function public.set_updated_at();

alter table public.venue_pricing_rules enable row level security;

create policy "admins read pricing rules"
  on public.venue_pricing_rules for select to authenticated
  using ((select public.is_platform_admin()));

create policy "venues read own pricing rules"
  on public.venue_pricing_rules for select to authenticated
  using (venue_id = (select public.current_venue_id()));
