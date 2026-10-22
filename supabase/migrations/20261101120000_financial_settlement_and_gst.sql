-- =============================================================================
-- Financial settlement: ERP targets, ITC review, PO line references
-- -----------------------------------------------------------------------------
-- Builds on what exists (gst-engine + bookings.gst_type/sac_code, booking_invoices,
-- expense_exports, purchase_orders/po_allocations, payment_events) rather than
-- duplicating it:
--
-- - Expense/ERP targets gain Zoho Expense and ERPNext. A booking can now be
--   exported once per provider (finance may send it to more than one system);
--   a failed export is still retried in place.
-- - bookings.itc_decision: finance's call on input tax credit ('eligible' |
--   'blocked', with who/when/why). Null = not reviewed. Eligibility isn't
--   assumed: credit on food, beverages and catering is often blocked under
--   Sec. 17(5) CGST Act, so the app treats undecided bookings as pending
--   review (lib/finance/itc.ts).
-- - po_allocations.line_number: the booking's line on its blanket PO, so it
--   has a stable reference like "PO-2026-014/L3".
-- =============================================================================

-- 1 · Zoho Expense and ERPNext -------------------------------------------------------------------
alter table public.companies drop constraint if exists companies_expense_provider_check;
alter table public.companies add constraint companies_expense_provider_check
  check (expense_provider in ('webhook', 'ramp', 'brex', 'concur', 'zoho', 'erpnext'));
comment on column public.companies.expense_provider is
  'Where confirmed bookings are exported by default: a signed webhook, Ramp, Brex, SAP Concur, Zoho Expense or ERPNext.';

alter table public.expense_exports drop constraint if exists expense_exports_provider_check;
alter table public.expense_exports add constraint expense_exports_provider_check
  check (provider in ('webhook', 'ramp', 'brex', 'concur', 'zoho', 'erpnext'));

-- One export per subject, event and provider (was: per subject and event).
alter table public.expense_exports drop constraint if exists expense_exports_booking_id_event_key;
alter table public.expense_exports drop constraint if exists expense_exports_order_event_key;
alter table public.expense_exports drop constraint if exists expense_exports_booking_event_provider_key;
alter table public.expense_exports drop constraint if exists expense_exports_order_event_provider_key;
alter table public.expense_exports
  add constraint expense_exports_booking_event_provider_key unique (booking_id, event, provider),
  add constraint expense_exports_order_event_provider_key unique (catalog_order_id, event, provider);

-- Who sent it by hand (null = sent automatically on confirmation).
alter table public.expense_exports add column if not exists requested_by uuid;

-- 2 · Input tax credit review --------------------------------------------------------------------
alter table public.bookings
  add column if not exists itc_decision    text check (itc_decision in ('eligible', 'blocked')),
  add column if not exists itc_decided_by  uuid,
  add column if not exists itc_decided_at  timestamptz,
  add column if not exists itc_note        text check (itc_note is null or length(itc_note) <= 500);

alter table public.bookings drop constraint if exists bookings_itc_decision_recorded;
alter table public.bookings add constraint bookings_itc_decision_recorded
  check ((itc_decision is null) = (itc_decided_at is null));

comment on column public.bookings.itc_decision is
  'Finance''s input tax credit call: eligible | blocked. Null = not reviewed (claim nothing yet).';

-- 3 · PO line references -------------------------------------------------------------------------
alter table public.po_allocations add column if not exists line_number integer check (line_number >= 1);

-- Existing allocations: numbered per PO in the order they were made.
update public.po_allocations a set line_number = n.rn
from (select id, row_number() over (partition by po_id order by created_at, id) rn from public.po_allocations) n
where a.id = n.id and a.line_number is null;

alter table public.po_allocations drop constraint if exists po_allocations_po_line_key;
alter table public.po_allocations add constraint po_allocations_po_line_key unique (po_id, line_number);

-- Always set by this trigger (nullable only so inserts needn't pass it).
-- The next line on the PO, under the PO row lock (fires before po_allocations_check,
-- which takes the same lock). Moving an allocation to another PO gives it a new line there.
create or replace function public.po_allocations_assign_line()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.po_id = old.po_id then
    new.line_number := old.line_number;
    return new;
  end if;
  perform 1 from public.purchase_orders where id = new.po_id for update;
  select coalesce(max(line_number), 0) + 1 into new.line_number from public.po_allocations where po_id = new.po_id;
  return new;
end;
$$;

drop trigger if exists po_allocations_assign_line on public.po_allocations;
create trigger po_allocations_assign_line
  before insert or update of po_id on public.po_allocations
  for each row execute function public.po_allocations_assign_line();

comment on column public.po_allocations.line_number is 'This allocation''s line on its PO: the booking''s reference is "<po_number>/L<line_number>".';
