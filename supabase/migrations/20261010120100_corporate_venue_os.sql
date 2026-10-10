-- =============================================================================
-- 0019 · Corporate venue operating system
-- -----------------------------------------------------------------------------
-- Extends the existing model (venues, corporate_policies, bookings,
-- expense_exports) rather than replacing it:
--
--   venues              per-head minimum spend, private dining suites, seating
--                       layouts, alcohol service, entertainment and cancellation
--                       terms (negotiated discounts stay in corporate_rate_cards)
--   corporate_policies  alcohol and entertainment compliance (companies already
--                       carry monthly_spend_limit_inr; it is now enforced)
--   bookings            what the event includes, and when it was settled
--   companies           which expense system bookings are exported to
--   expense_exports     the provider each export went to; failed exports retry
-- =============================================================================

-- 1 · Venue profile ----------------------------------------------------------------------------
alter table public.venues
  add column if not exists min_spend_per_head_inr numeric(14,2) not null default 0
    check (min_spend_per_head_inr >= 0),
  -- [{ "name": "The Vault", "seats": 24, "min_spend_inr": 60000 }]
  add column if not exists private_suites jsonb not null default '[]'::jsonb
    check (jsonb_typeof(private_suites) = 'array'),
  -- [{ "layout": "banquet" | "cocktail" | "theatre" | "boardroom" | "classroom", "capacity": 80 }]
  add column if not exists seating_layouts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(seating_layouts) = 'array'),
  add column if not exists serves_alcohol boolean not null default true,
  -- e.g. {live_music, dj, karaoke, comedy, games}
  add column if not exists entertainment text[] not null default '{}',
  -- Refund tiers, most notice first: [{ "days_before": 14, "refund_pct": 100 }, { "days_before": 3, "refund_pct": 50 }]
  add column if not exists cancellation_terms jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cancellation_terms) = 'array');

comment on column public.venues.min_spend_per_head_inr is 'Minimum spend per guest (pre-GST), on top of the venue-wide min_spend_inr.';
comment on column public.venues.private_suites is 'Private dining suites: name, seats, min_spend_inr.';
comment on column public.venues.seating_layouts is 'Seating plans: layout and capacity in that layout.';
comment on column public.venues.cancellation_terms is 'Refund tiers by notice period; cancellations inside every tier are not refunded.';

-- 2 · Policy compliance ------------------------------------------------------------------------
alter table public.corporate_policies
  -- allowed: no rule · approval: events with alcohol need sign-off · prohibited: never booked
  add column if not exists alcohol_policy text not null default 'allowed'
    check (alcohol_policy in ('allowed', 'approval', 'prohibited')),
  -- Entertainment that needs sign-off, e.g. {dj, karaoke}.
  add column if not exists restricted_entertainment text[] not null default '{}';

comment on column public.corporate_policies.alcohol_policy is 'allowed | approval (needs sign-off) | prohibited (blocked).';
comment on column public.corporate_policies.restricted_entertainment is 'Entertainment types that need sign-off.';

-- 3 · Booking contents and settlement ----------------------------------------------------------
alter table public.bookings
  add column if not exists alcohol_included boolean not null default false,
  add column if not exists entertainment text[] not null default '{}',
  add column if not exists settled_at timestamptz,
  -- The expense system's id for the reimbursement (Ramp transaction, Concur report, …).
  add column if not exists expense_reference text,
  add constraint bookings_settled_at_check check ((status = 'SETTLED') = (settled_at is not null)) not valid;

-- Lifecycle: COMPLETED can now be SETTLED; SETTLED and CANCELLED are final.
create or replace function public.bookings_guard_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status in ('SETTLED', 'CANCELLED') then
    raise exception 'Booking % is % and cannot move to %', old.id, old.status, new.status;
  end if;

  if old.status = 'PENDING_APPROVAL' and new.status not in ('PENDING', 'CANCELLED') then
    raise exception 'PENDING_APPROVAL bookings can only become PENDING or CANCELLED (got %)', new.status;
  end if;

  if old.status = 'PENDING' and new.status not in ('CONFIRMED', 'CANCELLED') then
    raise exception 'PENDING bookings can only become CONFIRMED or CANCELLED (got %)', new.status;
  end if;

  if old.status = 'CONFIRMED' and new.status not in ('COMPLETED', 'CANCELLED') then
    raise exception 'CONFIRMED bookings can only become COMPLETED or CANCELLED (got %)', new.status;
  end if;

  if old.status = 'COMPLETED' and new.status <> 'SETTLED' then
    raise exception 'COMPLETED bookings can only become SETTLED (got %)', new.status;
  end if;

  return new;
end;
$$;

-- 4 · Expense providers ------------------------------------------------------------------------
alter table public.companies
  add column if not exists expense_provider text not null default 'webhook'
    check (expense_provider in ('webhook', 'ramp', 'brex', 'concur'));

comment on column public.companies.expense_provider is 'Where confirmed bookings are exported: a signed webhook, Ramp, Brex or SAP Concur.';

alter table public.expense_exports
  add column if not exists provider text not null default 'webhook'
    check (provider in ('webhook', 'ramp', 'brex', 'concur')),
  -- A failed export is retried in place (unique (booking_id, event) keeps one row).
  add column if not exists attempts integer not null default 1 check (attempts >= 1),
  add column if not exists updated_at timestamptz not null default now();

create trigger expense_exports_set_updated_at
  before update on public.expense_exports
  for each row execute function public.set_updated_at();
