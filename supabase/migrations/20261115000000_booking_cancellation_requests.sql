-- =============================================================================
-- Booking cancellation requests: a company asks to cancel a confirmed booking
-- -----------------------------------------------------------------------------
-- Refund Policy (/refunds): before the venue confirms, the company cancels
-- outright (status CANCELLED, deposit released). After it confirms, the
-- company requests cancellation; Lufer settles the refund the venue's terms
-- give for the notice, by hand, and then cancels the booking. These columns
-- record that request so it shows on the event and isn't sent twice. The time
-- recorded is the time used for the notice period.
--
-- Written by the app with the service role only (it checks the requester or an
-- Approver of the company); clients read their company's bookings as before.
-- =============================================================================

alter table public.bookings
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_requested_by uuid references auth.users (id) on delete set null,
  add column if not exists cancellation_reason       text check (cancellation_reason is null or char_length(cancellation_reason) <= 500);

comment on column public.bookings.cancellation_requested_at is 'When the company asked to cancel a confirmed booking (the notice time for the venue''s refund terms). Null: not requested.';
comment on column public.bookings.cancellation_requested_by is 'Who asked to cancel (the requester or an Approver).';
comment on column public.bookings.cancellation_reason is 'Optional reason the company gave when cancelling or requesting cancellation.';

-- -----------------------------------------------------------------------------
-- Withdrawn requests stop escalating
-- -----------------------------------------------------------------------------
-- A company can now cancel a request while it waits for sign-off. Its approvals
-- stay PENDING (there's nothing to decide), so the overdue sweep must skip any
-- approval whose booking or order is no longer PENDING_APPROVAL; otherwise it
-- would hand a withdrawn request up the chain. Same function, one more filter.

create or replace function public.escalate_overdue_approvals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  moved integer := 0;
begin
  for r in
    select a.id from public.booking_approvals a
      left join public.bookings b on b.id = a.booking_id
      left join public.catalog_orders o on o.id = a.catalog_order_id
     where a.status = 'PENDING' and a.due_at < now()
       and coalesce(b.status::text, o.status::text) = 'PENDING_APPROVAL'
     order by a.due_at
  loop
    begin
      perform public.escalate_booking_approval(r.id, 'Escalated automatically: no decision within the approval deadline');
      moved := moved + 1;
    exception when sqlstate '23514' then
      -- Nobody higher up: it stays with its approver and is retried on the next sweep.
      null;
    end;
  end loop;
  return moved;
end;
$$;

revoke all on function public.escalate_overdue_approvals() from public, anon, authenticated;
grant execute on function public.escalate_overdue_approvals() to service_role;
