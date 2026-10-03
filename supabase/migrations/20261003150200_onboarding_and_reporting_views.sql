-- =============================================================================
-- 0003 · Venue onboarding pipeline + reporting views for the three portals
-- =============================================================================

-- Venue onboarding requests (Admin portal queue) ------------------------------------
do $$ begin
  create type public.onboarding_status as enum ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
exception when duplicate_object then null; end $$;

create table if not exists public.venue_onboarding_requests (
  id                     uuid primary key default gen_random_uuid(),
  venue_name             text not null,
  city                   text not null,
  neighborhood           text not null,
  gstin                  char(15) not null check (public.is_valid_gstin(gstin)),
  contact_name           text not null,
  contact_email          text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  capacity_max           integer check (capacity_max is null or capacity_max > 0),
  pdr_available          boolean not null default false,
  proposed_commission_rate numeric(5,4) not null default 0.15
                           check (proposed_commission_rate >= 0 and proposed_commission_rate <= 1),
  status                 public.onboarding_status not null default 'SUBMITTED',
  venue_id               uuid references public.venues (id) on delete set null, -- set once approved
  submitted_at           timestamptz not null default now(),
  reviewed_at            timestamptz
);

create index if not exists venue_onboarding_status_idx on public.venue_onboarding_requests (status);

-- Per-booking tax breakdown (amounts in INR, rounded to paise) -----------------------
-- Mirrors lib/gst-engine.ts: 9% + 9% intra-state, 18% inter-state.
create or replace view public.booking_tax_breakdown
with (security_invoker = true) as
select
  b.id                                   as booking_id,
  b.company_id,
  b.venue_id,
  b.status,
  b.event_date,
  b.sac_code,
  b.gst_type,
  b.total_amount_inr                     as taxable_value_inr,
  case when b.gst_type = 'CGST_SGST' then round(b.total_amount_inr * 0.09, 2) else 0 end as cgst_inr,
  case when b.gst_type = 'CGST_SGST' then round(b.total_amount_inr * 0.09, 2) else 0 end as sgst_inr,
  case when b.gst_type = 'IGST'      then round(b.total_amount_inr * 0.18, 2) else 0 end as igst_inr,
  case when b.gst_type = 'CGST_SGST'
       then 2 * round(b.total_amount_inr * 0.09, 2)
       else round(b.total_amount_inr * 0.18, 2) end                                    as total_gst_inr,
  round(b.total_amount_inr * v.commission_rate, 2)                                     as commission_inr,
  b.total_amount_inr - round(b.total_amount_inr * v.commission_rate, 2)                as venue_payout_inr
from public.bookings b
join public.venues v on v.id = b.venue_id;

comment on view public.booking_tax_breakdown is
  'GST split, platform commission and venue payout per booking. Payout is on taxable value; GST is passed through separately.';

-- Admin portal: platform-wide KPIs --------------------------------------------------
-- GBV counts every non-cancelled booking; commission is recognised on CONFIRMED + COMPLETED.
create or replace view public.platform_metrics
with (security_invoker = true) as
select
  count(*)                                                                  as total_bookings,
  count(*) filter (where status = 'PENDING')                                as pending_bookings,
  coalesce(sum(taxable_value_inr) filter (where status <> 'CANCELLED'), 0)  as gross_booking_value_inr,
  coalesce(sum(commission_inr) filter (where status in ('CONFIRMED', 'COMPLETED')), 0) as commission_earned_inr
from public.booking_tax_breakdown;

-- Property portal: monthly payouts per venue ---------------------------------------
create or replace view public.venue_monthly_payouts
with (security_invoker = true) as
select
  venue_id,
  date_trunc('month', event_date)::date                      as payout_month,
  count(*)                                                   as bookings,
  sum(taxable_value_inr)                                     as taxable_value_inr,
  sum(commission_inr)                                        as commission_inr,
  sum(venue_payout_inr)                                      as payout_inr,
  bool_and(status = 'COMPLETED')                             as fully_settled
from public.booking_tax_breakdown
where status in ('CONFIRMED', 'COMPLETED')
group by venue_id, date_trunc('month', event_date);

-- Client portal: ITC (input tax credit) eligible per company ------------------------
-- Only COMPLETED bookings have an invoice issued, so only they count as reclaimed.
create or replace view public.company_itc_summary
with (security_invoker = true) as
select
  company_id,
  coalesce(sum(total_gst_inr) filter (where status = 'COMPLETED'), 0)                as itc_reclaimed_inr,
  coalesce(sum(total_gst_inr) filter (where status in ('PENDING', 'CONFIRMED')), 0)  as itc_pipeline_inr,
  coalesce(sum(taxable_value_inr) filter (where status <> 'CANCELLED'), 0)           as committed_spend_inr
from public.booking_tax_breakdown
group by company_id;
