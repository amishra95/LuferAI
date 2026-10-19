-- =============================================================================
-- 0031 · Contracts, e-signatures and instalment invoicing
-- -----------------------------------------------------------------------------
-- companies.contracts_required  When on, a booking reaches CONFIRMED only through an
--                               executed contract (the venue's plain Confirm is refused).
-- contracts                     One agreement per booking revision: the merged terms
--                               (pricing, headcount, dates, venue rules, Sprint 5 sign-offs),
--                               the exact HTML issued and its SHA-256. Both are immutable.
--                                 awaiting_client ─► awaiting_venue ─► executed
--                                 …declined / voided before execution.
--                               At most one live contract per booking.
-- contract_signatures           Append-only. The client signs first, then the venue
--                               countersigns; each records the document hash it signed.
--                               The venue's signature executes the contract and confirms
--                               the booking in the same transaction.
-- contract_events               Append-only audit trail (issued, viewed, signed, declined,
--                               voided, provider callbacks).
-- contract_webhook_events       Processed e-signature provider callbacks, for idempotency.
-- booking_invoices              The payment schedule created on execution: a deposit and
--                               a balance instalment, each a GST tax invoice numbered per
--                               venue (the supplier) per Indian FY: 2026-27/000001.
--                                 scheduled ─► issued ─► paid   (or void)
-- payments.booking_invoice_id   An instalment's checkout. Captured payments mark their
--                               invoice paid; cancelling a booking voids open invoices.
--
-- The app writes through the service role (lib/services/contracts); clients read their
-- company's rows, venue managers their venue's, admins everything.
-- =============================================================================

-- 1 · Company setting -----------------------------------------------------------------------
alter table public.companies
  add column if not exists contracts_required boolean not null default false;

comment on column public.companies.contracts_required is
  'Bookings are confirmed by an executed contract (client signs, venue countersigns), not the venue''s Confirm.';

-- 2 · Contracts ------------------------------------------------------------------------------
create table if not exists public.contracts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.companies (id) on delete cascade,
  booking_id           uuid not null,
  venue_id             uuid not null references public.venues (id) on delete cascade,
  revision             smallint not null default 1 check (revision between 1 and 99),
  status               text not null default 'awaiting_client'
                         check (status in ('awaiting_client', 'awaiting_venue', 'executed', 'declined', 'voided')),
  template_key         text not null check (char_length(template_key) between 1 and 60),
  template_version     text not null check (char_length(template_version) between 1 and 20),
  terms                jsonb not null,
  document_html        text not null,
  document_sha256      text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  provider             text not null default 'in_app' check (provider in ('in_app', 'dropbox_sign')),
  provider_request_id  text,
  issued_by            uuid references auth.users (id) on delete set null,
  issued_at            timestamptz not null default now(),
  executed_at          timestamptz,
  closed_at            timestamptz,
  close_reason         text check (close_reason is null or char_length(close_reason) <= 500),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint contracts_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade,
  constraint contracts_booking_revision_key unique (booking_id, revision),
  constraint contracts_provider_request_key unique (provider, provider_request_id),
  constraint contracts_executed_check check ((status = 'executed') = (executed_at is not null)),
  constraint contracts_closed_check check ((status in ('declined', 'voided')) = (closed_at is not null))
);

comment on table public.contracts is 'Booking agreements: merged terms and the exact document issued for signature.';

create unique index if not exists contracts_one_live_per_booking
  on public.contracts (booking_id) where status in ('awaiting_client', 'awaiting_venue', 'executed');
create index if not exists contracts_tenant_idx on public.contracts (tenant_id, created_at desc);
create index if not exists contracts_venue_idx on public.contracts (venue_id, created_at desc);

create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

-- The document never changes once issued, and status only moves forward.
create or replace function public.contracts_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.id, new.tenant_id, new.booking_id, new.venue_id, new.revision, new.template_key, new.template_version,
      new.terms, new.document_html, new.document_sha256, new.provider, new.issued_by, new.issued_at)
     is distinct from
     (old.id, old.tenant_id, old.booking_id, old.venue_id, old.revision, old.template_key, old.template_version,
      old.terms, old.document_html, old.document_sha256, old.provider, old.issued_by, old.issued_at)
  then
    raise exception 'Contract % was issued and can''t be edited; void it and issue a new revision', old.id
      using errcode = '23514', hint = 'contract_immutable';
  end if;
  if new.provider_request_id is distinct from old.provider_request_id and old.provider_request_id is not null then
    raise exception 'Contract % is already with its signing provider', old.id using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'awaiting_client' and new.status in ('awaiting_venue', 'declined', 'voided')) or
      (old.status = 'awaiting_venue'  and new.status in ('executed', 'declined', 'voided'))
    ) then
      raise exception 'Contract % is % and cannot move to %', old.id, old.status, new.status
        using errcode = '23514', hint = 'contract_transition';
    end if;
    if new.status = 'awaiting_venue' and not exists (
      select 1 from public.contract_signatures s where s.contract_id = new.id and s.party = 'client') then
      raise exception 'Contract % needs the client''s signature first', old.id using errcode = '23514', hint = 'contract_transition';
    end if;
    if new.status = 'executed' and (select count(*) from public.contract_signatures s where s.contract_id = new.id) < 2 then
      raise exception 'Contract % needs both signatures to execute', old.id using errcode = '23514', hint = 'contract_transition';
    end if;
    new.executed_at := case when new.status = 'executed' then now() else old.executed_at end;
    new.closed_at := case when new.status in ('declined', 'voided') then now() else old.closed_at end;
  end if;
  return new;
end;
$$;

create trigger contracts_guard_update
  before update on public.contracts
  for each row execute function public.contracts_guard_update();

-- 3 · Signatures -----------------------------------------------------------------------------
create table if not exists public.contract_signatures (
  id                     uuid primary key default gen_random_uuid(),
  contract_id            uuid not null references public.contracts (id) on delete cascade,
  party                  text not null check (party in ('client', 'venue')),
  signer_user_id         uuid references auth.users (id) on delete set null,
  signer_name            text not null check (char_length(btrim(signer_name)) between 2 and 120),
  signer_title           text check (signer_title is null or char_length(signer_title) <= 120),
  signer_email           text check (signer_email is null or char_length(signer_email) <= 320),
  -- The hash of the document the signer saw; must be the contract's.
  document_sha256        text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  ip_address             text check (ip_address is null or char_length(ip_address) <= 64),
  user_agent             text check (user_agent is null or char_length(user_agent) <= 500),
  provider_signature_id  text,
  signed_at              timestamptz not null default now(),
  constraint contract_signatures_party_key unique (contract_id, party)
);

comment on table public.contract_signatures is 'Append-only signatures: the client''s, then the venue''s countersignature.';

-- Who may sign when, on what: the client first, then the venue, on the issued document.
create or replace function public.contract_signatures_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c public.contracts%rowtype;
begin
  select * into c from public.contracts where id = new.contract_id for update;
  if new.document_sha256 <> c.document_sha256 then
    raise exception 'The signed document doesn''t match contract % as issued', c.id using errcode = '23514', hint = 'contract_hash';
  end if;
  if new.party = 'client' and c.status <> 'awaiting_client' then
    raise exception 'Contract % is % and isn''t waiting for the client''s signature', c.id, c.status using errcode = '23514', hint = 'contract_order';
  end if;
  if new.party = 'venue' and c.status <> 'awaiting_venue' then
    raise exception 'Contract % is % and isn''t waiting for the venue''s countersignature', c.id, c.status using errcode = '23514', hint = 'contract_order';
  end if;
  new.signed_at := now();
  return new;
end;
$$;

create trigger contract_signatures_check
  before insert on public.contract_signatures
  for each row execute function public.contract_signatures_check();

-- A signature advances the contract; the countersignature executes it and confirms the booking.
-- SECURITY DEFINER: the bookings guard below needs the executed contract visible whoever signs.
create or replace function public.contract_signatures_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts%rowtype;
begin
  select * into c from public.contracts where id = new.contract_id;
  if new.party = 'client' then
    update public.contracts set status = 'awaiting_venue' where id = c.id;
  else
    update public.contracts set status = 'executed' where id = c.id;
    update public.bookings set status = 'CONFIRMED' where id = c.booking_id and status = 'PENDING';
    if not found then
      raise exception 'Booking % is no longer with the venue, so contract % can''t be executed', c.booking_id, c.id
        using errcode = '23514', hint = 'contract_booking_state';
    end if;
  end if;
  insert into public.contract_events (contract_id, action, actor_user_id, detail)
  values (c.id, case when new.party = 'client' then 'client_signed' else 'executed' end, new.signer_user_id,
          jsonb_build_object('signer', new.signer_name, 'document_sha256', new.document_sha256));
  return null;
end;
$$;

create trigger contract_signatures_advance
  after insert on public.contract_signatures
  for each row execute function public.contract_signatures_advance();

create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger contract_signatures_append_only
  before update or delete on public.contract_signatures
  for each row
  when (pg_trigger_depth() = 0)
  execute function public.forbid_mutation();

-- 4 · Audit trail and provider callbacks -------------------------------------------------------
create table if not exists public.contract_events (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references public.contracts (id) on delete cascade,
  action         text not null check (action in (
                   'issued', 'sent_to_provider', 'viewed', 'client_signed', 'executed', 'declined', 'voided',
                   'provider_callback', 'invoices_scheduled', 'post_execution_failed')),
  actor_user_id  uuid references auth.users (id) on delete set null,
  actor_role     text,
  detail         jsonb not null default '{}'::jsonb,
  at             timestamptz not null default now()
);

create index if not exists contract_events_contract_idx on public.contract_events (contract_id, at);

create trigger contract_events_append_only
  before update or delete on public.contract_events
  for each row
  when (pg_trigger_depth() = 0)
  execute function public.forbid_mutation();

create table if not exists public.contract_webhook_events (
  provider     text not null,
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);

comment on table public.contract_webhook_events is 'Processed e-signature callbacks, for idempotency. Service role only.';

-- 5 · The contract requirement on confirmation -----------------------------------------------
-- Every path to CONFIRMED (the venue's Confirm, converting a hold, the booking agent) is held
-- to it here; the countersignature trigger above is the only way through.
create or replace function public.bookings_require_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.companies where id = new.company_id and contracts_required)
     and not exists (select 1 from public.contracts where booking_id = new.id and status = 'executed') then
    raise exception 'Booking % is confirmed by its signed contract: the client signs, then the venue countersigns', new.id
      using errcode = '23514', hint = 'contract_required';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_require_contract on public.bookings;
create trigger bookings_require_contract
  before update of status on public.bookings
  for each row
  when (new.status = 'CONFIRMED' and old.status is distinct from 'CONFIRMED')
  execute function public.bookings_require_contract();

-- 6 · Invoices -------------------------------------------------------------------------------
create table if not exists public.booking_invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.companies (id) on delete cascade,
  booking_id      uuid not null,
  contract_id     uuid not null references public.contracts (id) on delete restrict,
  -- The supplier: invoices are numbered in its series.
  venue_id        uuid not null references public.venues (id) on delete cascade,
  kind            text not null check (kind in ('deposit', 'balance')),
  sequence        smallint not null check (sequence between 1 and 10),
  status          text not null default 'scheduled' check (status in ('scheduled', 'issued', 'paid', 'void')),
  invoice_number  text,
  taxable_inr     numeric(14,2) not null check (taxable_inr >= 0),
  cgst_inr        numeric(14,2) not null default 0 check (cgst_inr >= 0),
  sgst_inr        numeric(14,2) not null default 0 check (sgst_inr >= 0),
  igst_inr        numeric(14,2) not null default 0 check (igst_inr >= 0),
  total_inr       numeric(14,2) not null check (total_inr > 0),
  -- Parties, place of supply, SAC and rate: the tax invoice as rendered.
  gst             jsonb not null,
  issue_on        date not null,
  due_on          date not null,
  issued_at       timestamptz,
  paid_at         timestamptz,
  voided_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint booking_invoices_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade,
  constraint booking_invoices_contract_kind_key unique (contract_id, kind),
  constraint booking_invoices_number_key unique (venue_id, invoice_number),
  constraint booking_invoices_total_check check (total_inr = taxable_inr + cgst_inr + sgst_inr + igst_inr),
  constraint booking_invoices_due_check check (due_on >= issue_on),
  constraint booking_invoices_number_check check ((status in ('issued', 'paid')) <= (invoice_number is not null))
);

comment on table public.booking_invoices is 'Instalment tax invoices from an executed contract, numbered per venue per FY.';

create index if not exists booking_invoices_booking_idx on public.booking_invoices (booking_id);
create index if not exists booking_invoices_issue_idx on public.booking_invoices (issue_on) where status = 'scheduled';

create trigger booking_invoices_set_updated_at
  before update on public.booking_invoices
  for each row execute function public.set_updated_at();

create table if not exists public.invoice_number_series (
  venue_id     uuid not null references public.venues (id) on delete cascade,
  fiscal_year  text not null check (fiscal_year ~ '^\d{4}-\d{2}$'),
  last_number  integer not null default 0 check (last_number >= 0),
  primary key (venue_id, fiscal_year)
);

comment on table public.invoice_number_series is 'Consecutive invoice serials per supplier (venue) per Indian FY.';

-- 'YYYY-YY' for the Indian FY (Apr–Mar) containing a date.
create or replace function public.indian_fiscal_year(d date)
returns text
language sql
immutable
as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0') end
$$;

-- Status moves forward only; issuing (or paying a scheduled one) takes the next serial.
create or replace function public.booking_invoices_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  fy text;
  n  integer;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and not (
    (old.status = 'scheduled' and new.status in ('issued', 'paid', 'void')) or
    (old.status = 'issued' and new.status in ('paid', 'void'))
  ) then
    raise exception 'Invoice % is % and cannot move to %', old.id, old.status, new.status using errcode = '23514', hint = 'invoice_transition';
  end if;
  if tg_op = 'UPDATE' and old.invoice_number is not null and (
     (new.taxable_inr, new.cgst_inr, new.sgst_inr, new.igst_inr, new.total_inr, new.gst, new.invoice_number)
     is distinct from (old.taxable_inr, old.cgst_inr, old.sgst_inr, old.igst_inr, old.total_inr, old.gst, old.invoice_number)) then
    raise exception 'Invoice % is issued and can''t be changed', old.id using errcode = '23514', hint = 'invoice_immutable';
  end if;

  if new.status in ('issued', 'paid') and new.invoice_number is null then
    new.issued_at := coalesce(new.issued_at, now());
    fy := public.indian_fiscal_year((new.issued_at at time zone 'Asia/Kolkata')::date);
    insert into public.invoice_number_series as s (venue_id, fiscal_year, last_number)
    values (new.venue_id, fy, 1)
    on conflict (venue_id, fiscal_year) do update set last_number = s.last_number + 1
    returning last_number into n;
    new.invoice_number := fy || '/' || lpad(n::text, 6, '0');
  end if;
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  if new.status = 'void' and (tg_op = 'INSERT' or old.status <> 'void') then
    new.voided_at := now();
  end if;
  return new;
end;
$$;

create trigger booking_invoices_guard
  before insert or update on public.booking_invoices
  for each row execute function public.booking_invoices_guard();

-- 7 · Payments for instalments ---------------------------------------------------------------
alter table public.payments
  add column if not exists booking_invoice_id uuid references public.booking_invoices (id) on delete set null;

alter table public.booking_invoices
  add column if not exists payment_id uuid references public.payments (id) on delete set null;

-- The pre-confirmation deposit stays one per booking; each instalment gets its own live payment.
drop index if exists public.payments_one_live_per_booking;
create unique index if not exists payments_one_live_per_booking
  on public.payments (booking_id) where status in ('authorized', 'captured') and booking_invoice_id is null;
create unique index if not exists payments_one_live_per_invoice
  on public.payments (booking_invoice_id) where status in ('authorized', 'captured');

-- A captured payment settles its instalment (or the deposit invoice it was linked to).
create or replace function public.payments_settle_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.booking_invoices
     set status = 'paid', payment_id = new.id
   where status in ('scheduled', 'issued')
     and (id = new.booking_invoice_id or payment_id = new.id);
  return null;
end;
$$;

create trigger payments_settle_invoice
  after insert or update of status on public.payments
  for each row
  when (new.status = 'captured')
  execute function public.payments_settle_invoice();

-- Cancelling a booking voids its open invoices and closes an unsigned contract.
create or replace function public.bookings_close_contracts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.booking_invoices set status = 'void' where booking_id = new.id and status in ('scheduled', 'issued');
  update public.contracts set status = 'voided', close_reason = 'Booking cancelled'
   where booking_id = new.id and status in ('awaiting_client', 'awaiting_venue');
  return new;
end;
$$;

create trigger bookings_close_contracts
  after update of status on public.bookings
  for each row
  when (new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED')
  execute function public.bookings_close_contracts();

-- Row Level Security -------------------------------------------------------------------------
alter table public.contracts               enable row level security;
alter table public.contract_signatures     enable row level security;
alter table public.contract_events         enable row level security;
alter table public.contract_webhook_events enable row level security;
alter table public.booking_invoices        enable row level security;
alter table public.invoice_number_series   enable row level security;

create policy "admins read contracts"
  on public.contracts for select to authenticated
  using ((select public.is_platform_admin()));

create policy "tenant users read own contracts"
  on public.contracts for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "venue managers read own contracts"
  on public.contracts for select to authenticated
  using (venue_id = (select public.current_venue_id()));

-- Signatures and events are visible exactly when their contract is (its policies apply in the subquery).
create policy "contract parties read signatures"
  on public.contract_signatures for select to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id));

create policy "contract parties read events"
  on public.contract_events for select to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id));

create policy "admins read booking invoices"
  on public.booking_invoices for select to authenticated
  using ((select public.is_platform_admin()));

create policy "tenant users read own booking invoices"
  on public.booking_invoices for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "venue managers read own booking invoices"
  on public.booking_invoices for select to authenticated
  using (venue_id = (select public.current_venue_id()));

create policy "admins read invoice series"
  on public.invoice_number_series for select to authenticated
  using ((select public.is_platform_admin()));
