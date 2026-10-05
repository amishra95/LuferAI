-- =============================================================================
-- 0009 · Booking approval flow
-- -----------------------------------------------------------------------------
-- 1. Status transitions gain PENDING_APPROVAL → PENDING (signed off, now goes to
--    the venue) or CANCELLED (rejected / withdrawn).
-- 2. Deciding an approval moves its booking: REJECTED cancels it; APPROVED
--    releases it to the venue once no other approval on it is still open or
--    rejected (one tier today, ready for more). Done by trigger so the two rows
--    can never disagree, whichever client makes the decision.
-- 3. booking_approvals records the approver's note and decision time
--    separately, so the requester's reason survives the decision.
-- 4. Venues don't see a booking until it has been signed off.
-- =============================================================================

-- 1 · Transitions ---------------------------------------------------------------------
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

  if old.status = 'PENDING_APPROVAL' and new.status not in ('PENDING', 'CANCELLED') then
    raise exception 'PENDING_APPROVAL bookings can only become PENDING or CANCELLED (got %)', new.status;
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

-- 3 · Decision columns ----------------------------------------------------------------
alter table public.booking_approvals
  add column if not exists decision_note text,
  add column if not exists decided_at    timestamptz;

comment on column public.booking_approvals.reason        is 'Why approval was needed (policy breach), set when requested.';
comment on column public.booking_approvals.decision_note is 'Optional approver comment, set with the decision.';
comment on column public.booking_approvals.decided_at    is 'When the approval left PENDING. Trigger-set.';

-- Portal approvers may now set status and decision_note only (reason stays the requester's).
create or replace function public.booking_approvals_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'PENDING' and new.status is distinct from old.status then
    raise exception 'Approval % is already % and cannot move to %', old.id, old.status, new.status;
  end if;

  if new.status is distinct from old.status then
    new.decided_at := now();
  else
    new.decided_at := old.decided_at;
  end if;

  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;

  if old.status <> 'PENDING' then
    raise exception 'Approval % is already % and can no longer be edited', old.id, old.status
      using errcode = '42501';
  end if;

  if (new.id, new.tenant_id, new.booking_id, new.requested_by, new.approver_id, new.reason, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.booking_id, old.requested_by, old.approver_id, old.reason, old.created_at)
  then
    raise exception 'Only the status and decision note of approval % can be changed from a portal', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 2 · Decision moves the booking ---------------------------------------------------------
-- SECURITY DEFINER: the approver's own RLS may not allow PENDING_APPROVAL → PENDING.
create or replace function public.booking_approvals_apply_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'REJECTED' then
    update public.bookings set status = 'CANCELLED'
    where id = new.booking_id and status = 'PENDING_APPROVAL';
  elsif new.status = 'APPROVED' and not exists (
    select 1 from public.booking_approvals a
    where a.booking_id = new.booking_id and a.id <> new.id and a.status <> 'APPROVED'
  ) then
    update public.bookings set status = 'PENDING'
    where id = new.booking_id and status = 'PENDING_APPROVAL';
  end if;
  return null;
end;
$$;

drop trigger if exists booking_approvals_apply_decision on public.booking_approvals;
create trigger booking_approvals_apply_decision
  after update of status on public.booking_approvals
  for each row
  when (old.status = 'PENDING' and new.status <> 'PENDING')
  execute function public.booking_approvals_apply_decision();

-- 4 · Venues see a booking only once it's signed off ----------------------------------
drop policy if exists "property reads own bookings" on public.bookings;
create policy "property reads own bookings"
  on public.bookings for select to authenticated
  using (venue_id = public.current_venue_id() and status <> 'PENDING_APPROVAL');

drop policy if exists "property updates own bookings" on public.bookings;
create policy "property updates own bookings"
  on public.bookings for update to authenticated
  using (venue_id = public.current_venue_id() and status <> 'PENDING_APPROVAL')
  with check (venue_id = public.current_venue_id());
