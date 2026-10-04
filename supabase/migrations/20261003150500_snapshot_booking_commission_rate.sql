-- =============================================================================
-- 0006 · Snapshot the venue commission rate onto each booking
-- -----------------------------------------------------------------------------
-- booking_tax_breakdown priced commission off venues.commission_rate, so
-- changing a venue's rate silently rewrote commission and payouts on every
-- past booking, completed ones included. Each booking now stores the rate in
-- force when it was created, and all commission maths uses that copy.
--
-- - Set by trigger on insert (any caller-supplied value is overwritten), and
--   re-snapshotted if an admin moves the booking to a different venue.
-- - Admins may still correct it directly; portal users cannot change it.
-- =============================================================================

-- 1 · Column + backfill ----------------------------------------------------------
-- Existing bookings get their venue's current rate — the best record available.
alter table public.bookings
  add column if not exists commission_rate numeric(5,4)
    check (commission_rate >= 0 and commission_rate <= 1);

comment on column public.bookings.commission_rate is
  'Venue commission rate at booking time (0.15 = 15%). Trigger-set; not affected by later venue rate changes.';

-- Backfilling is not a user edit, so don't bump updated_at.
alter table public.bookings disable trigger bookings_set_updated_at;

update public.bookings b
set commission_rate = v.commission_rate
from public.venues v
where v.id = b.venue_id
  and b.commission_rate is null;

alter table public.bookings enable trigger bookings_set_updated_at;

alter table public.bookings alter column commission_rate set not null;

-- 2 · Snapshot trigger ----------------------------------------------------------
create or replace function public.bookings_snapshot_commission_rate()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.venue_id is distinct from old.venue_id then
    new.commission_rate := (select commission_rate from public.venues where id = new.venue_id);
    if new.commission_rate is null then
      raise exception 'Cannot snapshot commission rate: venue % not found', new.venue_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_snapshot_commission_rate on public.bookings;
create trigger bookings_snapshot_commission_rate
  before insert or update of venue_id on public.bookings
  for each row execute function public.bookings_snapshot_commission_rate();

-- 3 · Portal users can't change the snapshot ---------------------------------------
-- Same guard as migration 0005, with commission_rate added to the locked columns.
create or replace function public.bookings_guard_portal_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;

  if (new.id, new.company_id, new.venue_id, new.party_size, new.budget_per_head_inr,
      new.total_amount_inr, new.sac_code, new.gst_type, new.commission_rate,
      new.event_date, new.notes, new.created_at)
     is distinct from
     (old.id, old.company_id, old.venue_id, old.party_size, old.budget_per_head_inr,
      old.total_amount_inr, old.sac_code, old.gst_type, old.commission_rate,
      old.event_date, old.notes, old.created_at)
  then
    raise exception 'Only the status of booking % can be changed from a portal', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 4 · Tax view prices commission off the snapshot ----------------------------------
-- No venues join is needed any more. Column list and types are unchanged.
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
  case when commercials.visible
       then round(b.total_amount_inr * b.commission_rate, 2) end                       as commission_inr,
  case when commercials.visible
       then b.total_amount_inr - round(b.total_amount_inr * b.commission_rate, 2) end  as venue_payout_inr
from public.bookings b
cross join lateral (
  select auth.uid() is null
      or public.is_platform_admin()
      or b.venue_id = public.current_venue_id() as visible
) commercials;
