-- =============================================================================
-- 0005 · Fix GST view + RLS gaps
-- -----------------------------------------------------------------------------
-- 1. Portal users (CLIENT / PROPERTY) could rewrite any booking column through
--    their UPDATE policies — price, company_id, gst_type, sac_code, event_date.
--    RLS filters rows, not columns, so a trigger now limits them to `status`.
-- 2. gst_type could be written directly: the derive trigger only fired on
--    company_id / venue_id updates. It now also fires when gst_type is set.
-- 3. Clients could insert bookings for inactive venues or with any SAC code.
-- 4. booking_tax_breakdown inner-joined venues, so a client's bookings at a
--    venue later deactivated (invisible to them under venue RLS) disappeared
--    from the view and from company_itc_summary, under-reporting ITC. It also
--    showed clients the platform's commission and the venue's payout.
-- 5. Anonymous onboarding submissions could pre-fill reviewed_at.
-- =============================================================================

-- 1 · Portal users may change only a booking's status -----------------------------
-- Admins and server-side callers (service role / direct DB, where auth.uid() is
-- null) are unrestricted. Status moves are still checked by
-- bookings_guard_status_transition; RLS still decides which rows are reachable.
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
      new.total_amount_inr, new.sac_code, new.gst_type, new.event_date, new.notes, new.created_at)
     is distinct from
     (old.id, old.company_id, old.venue_id, old.party_size, old.budget_per_head_inr,
      old.total_amount_inr, old.sac_code, old.gst_type, old.event_date, old.notes, old.created_at)
  then
    raise exception 'Only the status of booking % can be changed from a portal', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_guard_portal_columns on public.bookings;
create trigger bookings_guard_portal_columns
  before update on public.bookings
  for each row execute function public.bookings_guard_portal_columns();

-- 2 · gst_type is always derived, even when written directly ------------------------
drop trigger if exists bookings_derive_gst_type on public.bookings;
create trigger bookings_derive_gst_type
  before insert or update of company_id, venue_id, gst_type on public.bookings
  for each row execute function public.bookings_derive_gst_type();

-- 3 · Clients book active venues under SAC 998596 only -------------------------------
drop policy if exists "clients create pending bookings" on public.bookings;
create policy "clients create pending bookings"
  on public.bookings for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and status = 'PENDING'
    and sac_code = '998596'
    and exists (
      select 1 from public.venues v
      where v.id = bookings.venue_id and v.is_active
    )
  );

-- 4 · Tax view: never drop bookings; commission only for admins and the venue -------
-- Column list and types are unchanged, so dependent views keep working.
-- GST arithmetic is unchanged and still mirrors lib/gst-engine.ts.
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
       then round(b.total_amount_inr * v.commission_rate, 2) end                       as commission_inr,
  case when commercials.visible
       then b.total_amount_inr - round(b.total_amount_inr * v.commission_rate, 2) end  as venue_payout_inr
from public.bookings b
left join public.venues v on v.id = b.venue_id
cross join lateral (
  select auth.uid() is null
      or public.is_platform_admin()
      or b.venue_id = public.current_venue_id() as visible
) commercials;

comment on view public.booking_tax_breakdown is
  'GST split, platform commission and venue payout per booking. Payout is on taxable value; GST is passed through separately. '
  'Commission and payout are null for clients.';

-- 5 · Onboarding submissions can't arrive pre-reviewed ------------------------------
drop policy if exists "anyone submits onboarding request" on public.venue_onboarding_requests;
create policy "anyone submits onboarding request"
  on public.venue_onboarding_requests for insert to anon, authenticated
  with check (status = 'SUBMITTED' and venue_id is null and reviewed_at is null);
