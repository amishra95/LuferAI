-- =============================================================================
-- 0002 · Core marketplace schema: companies, venues, bookings
-- -----------------------------------------------------------------------------
-- Money is stored as numeric(14,2) in INR. `total_amount_inr` on a booking is
-- the TAXABLE VALUE (pre-GST); tax is derived (see view booking_tax_breakdown
-- and lib/gst-engine.ts).
-- =============================================================================

-- Enums ----------------------------------------------------------------------------
do $$ begin
  create type public.gst_type as enum ('CGST_SGST', 'IGST');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.booking_status as enum ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED');
exception when duplicate_object then null; end $$;

-- updated_at helper ---------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- companies (demand side) -----------------------------------------------------------
create table if not exists public.companies (
  id                      uuid primary key default gen_random_uuid(),
  legal_name              text not null check (length(trim(legal_name)) > 0),
  gstin                   char(15) not null unique
                            check (public.is_valid_gstin(gstin)),
  -- Derived from the GSTIN so it can never drift out of sync.
  state_code              char(2) generated always as (substring(gstin from 1 for 2)) stored
                            references public.gst_state_codes (code),
  primary_contact_email   text not null
                            check (primary_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  monthly_spend_limit_inr numeric(14,2) not null default 0
                            check (monthly_spend_limit_inr >= 0),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table  public.companies is 'Corporate clients (demand side) booking hospitality via the platform.';
comment on column public.companies.state_code is 'GST state code — first 2 chars of gstin (generated).';

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- venues (supply side) --------------------------------------------------------------
create table if not exists public.venues (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  city             text not null,            -- e.g. 'Bengaluru'
  neighborhood     text not null,            -- e.g. 'Indiranagar'
  address          text not null,
  gstin            char(15) not null unique
                     check (public.is_valid_gstin(gstin)),
  state_code       char(2) generated always as (substring(gstin from 1 for 2)) stored
                     references public.gst_state_codes (code),
  pdr_available    boolean not null default false,  -- private dining room
  capacity_max     integer not null check (capacity_max > 0),
  min_spend_inr    numeric(14,2) not null default 0 check (min_spend_inr >= 0),
  commission_rate  numeric(5,4) not null default 0.15
                     check (commission_rate >= 0 and commission_rate <= 1),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table  public.venues is 'Hotels / restaurants / bars (supply side) listed on the platform.';
comment on column public.venues.commission_rate is 'Platform take rate on taxable booking value (0.15 = 15%).';

create index if not exists venues_city_neighborhood_idx on public.venues (city, neighborhood);

create trigger venues_set_updated_at
  before update on public.venues
  for each row execute function public.set_updated_at();

-- bookings -------------------------------------------------------------------------
create table if not exists public.bookings (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete restrict,
  venue_id              uuid not null references public.venues (id) on delete restrict,
  party_size            integer not null check (party_size > 0),
  budget_per_head_inr   numeric(14,2) not null check (budget_per_head_inr >= 0),
  total_amount_inr      numeric(14,2) not null check (total_amount_inr >= 0),
  sac_code              char(6) not null default '998596' check (sac_code ~ '^[0-9]{6}$'),
  -- Set automatically by trigger from company vs venue state codes.
  gst_type              public.gst_type not null,
  status                public.booking_status not null default 'PENDING',
  event_date            date not null,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table  public.bookings is 'Corporate event bookings. total_amount_inr is the pre-GST taxable value.';
comment on column public.bookings.gst_type is
  'CGST_SGST when company and venue share a GST state code (intra-state), otherwise IGST. Trigger-maintained.';

create index if not exists bookings_company_id_idx  on public.bookings (company_id);
create index if not exists bookings_venue_id_idx    on public.bookings (venue_id);
create index if not exists bookings_status_idx      on public.bookings (status);
create index if not exists bookings_event_date_idx  on public.bookings (event_date);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- Derive gst_type from the two parties' GSTIN state codes (mirrors lib/gst-engine.ts)
create or replace function public.bookings_derive_gst_type()
returns trigger
language plpgsql
as $$
declare
  company_state char(2);
  venue_state   char(2);
begin
  select state_code into company_state from public.companies where id = new.company_id;
  select state_code into venue_state   from public.venues    where id = new.venue_id;

  if company_state is null or venue_state is null then
    raise exception 'Cannot derive GST type: company % or venue % not found', new.company_id, new.venue_id;
  end if;

  new.gst_type := case when company_state = venue_state
                       then 'CGST_SGST'::public.gst_type
                       else 'IGST'::public.gst_type end;
  return new;
end;
$$;

create trigger bookings_derive_gst_type
  before insert or update of company_id, venue_id on public.bookings
  for each row execute function public.bookings_derive_gst_type();

-- Basic status-transition guard (COMPLETED / CANCELLED are terminal)
create or replace function public.bookings_guard_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'Booking % is % and cannot move to %', old.id, old.status, new.status;
  end if;

  if old.status = 'PENDING' and new.status not in ('CONFIRMED', 'CANCELLED') then
    raise exception 'PENDING bookings can only become CONFIRMED or CANCELLED (got %)', new.status;
  end if;

  if old.status = 'CONFIRMED' and new.status not in ('COMPLETED', 'CANCELLED') then
    raise exception 'CONFIRMED bookings can only become COMPLETED or CANCELLED (got %)', new.status;
  end if;

  return new;
end;
$$;

create trigger bookings_guard_status_transition
  before update of status on public.bookings
  for each row execute function public.bookings_guard_status_transition();
