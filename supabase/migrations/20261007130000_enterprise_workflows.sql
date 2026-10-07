-- Enterprise workflows -----------------------------------------------------------------------
-- 1. Expense metadata on bookings (cost centre, project code, billing GSTIN) and an audit log of
--    structured receipts exported to finance systems when a booking is confirmed.
-- 2. Corporate roles for client users (Organizer / Approver / Finance viewer).
-- 3. High-value threshold on corporate policies: above it a booking needs tier-1 *and* tier-2
--    sign-off (the existing booking_approvals_apply_decision trigger already waits for every
--    approval on a booking before releasing it to the venue).
-- 4. Discussion threads on approvals.
-- 5. A default cost centre on channel sender links (chat bookings need one too).

-- 1 · Expense metadata ---------------------------------------------------------------------
alter table public.bookings
  add column if not exists cost_center  text check (cost_center  ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$'),
  add column if not exists project_code text check (project_code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$'),
  -- GSTIN the invoice is billed to (a branch registration may differ from the company's main one).
  add column if not exists billing_gstin text check (billing_gstin is null or public.is_valid_gstin(billing_gstin));

-- Place of supply follows the GSTIN actually billed: a branch registration in another state
-- turns CGST+SGST into IGST (and vice versa), so derive gst_type from billing_gstin when set.
create or replace function public.bookings_derive_gst_type()
returns trigger
language plpgsql
as $$
declare
  buyer_state char(2);
  venue_state char(2);
begin
  if new.billing_gstin is not null then
    buyer_state := left(new.billing_gstin, 2);
  else
    select state_code into buyer_state from public.companies where id = new.company_id;
  end if;
  select state_code into venue_state from public.venues where id = new.venue_id;

  if buyer_state is null or venue_state is null then
    raise exception 'Cannot derive GST type: company % or venue % not found', new.company_id, new.venue_id;
  end if;

  new.gst_type := case when buyer_state = venue_state
                       then 'CGST_SGST'::public.gst_type
                       else 'IGST'::public.gst_type end;
  return new;
end;
$$;

drop trigger if exists bookings_derive_gst_type on public.bookings;
create trigger bookings_derive_gst_type
  before insert or update of company_id, venue_id, billing_gstin on public.bookings
  for each row execute function public.bookings_derive_gst_type();

create table if not exists public.expense_exports (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id) on delete cascade,
  tenant_id      uuid not null references public.companies (id) on delete cascade,
  event          text not null check (event in ('booking.confirmed')),
  receipt        jsonb not null,           -- queryable copy (jsonb reorders keys)
  payload        text not null,            -- the exact bytes sent
  -- SHA-256 of `payload`, so finance can verify what they received.
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  destination    text not null,           -- webhook URL, or 'mock' when none is configured
  status         text not null check (status in ('delivered', 'mocked', 'failed')),
  response_code  integer,
  error          text,
  created_at     timestamptz not null default now(),
  -- One export per booking per event: re-confirmation can't double-post an expense.
  unique (booking_id, event)
);

create index if not exists expense_exports_created_at_idx on public.expense_exports (created_at desc);
create index if not exists expense_exports_tenant_idx on public.expense_exports (tenant_id, created_at desc);

-- 2 · Corporate roles ------------------------------------------------------------------------
do $$ begin
  create type public.corporate_role as enum ('ORGANIZER', 'APPROVER', 'FINANCE_VIEWER');
exception when duplicate_object then null; end $$;

alter table public.platform_users
  add column if not exists corporate_role public.corporate_role;

-- Existing client users keep doing what they did: approvers in a chain approve, others organise.
update public.platform_users pu
  set corporate_role = case
    when exists (select 1 from public.approval_chains c where c.approver_user_id = pu.user_id) then 'APPROVER'::public.corporate_role
    else 'ORGANIZER'::public.corporate_role
  end
  where pu.role = 'CLIENT' and pu.corporate_role is null;

alter table public.platform_users
  add constraint platform_users_corporate_role_client_only
  check ((role = 'CLIENT') = (corporate_role is not null)) not valid;

-- 3 · High-value threshold -------------------------------------------------------------------
alter table public.corporate_policies
  add column if not exists high_value_threshold numeric(14,2) check (high_value_threshold > 0);

-- 4 · Approval threads -----------------------------------------------------------------------
create table if not exists public.approval_comments (
  id          uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.booking_approvals (id) on delete cascade,
  tenant_id   uuid not null references public.companies (id) on delete cascade,
  author_id   uuid not null,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  constraint approval_comments_author_fkey
    foreign key (author_id, tenant_id) references public.platform_users (user_id, company_id) on delete cascade
);

create index if not exists approval_comments_approval_idx on public.approval_comments (approval_id, created_at);

-- 5 · Channel default cost centre ------------------------------------------------------------
alter table public.channel_sender_links
  add column if not exists default_cost_center text check (default_cost_center ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$');

-- Row Level Security -----------------------------------------------------------------------
alter table public.expense_exports   enable row level security;
alter table public.approval_comments enable row level security;

create policy "admins read expense exports"
  on public.expense_exports for select to authenticated
  using (public.is_platform_admin());

create policy "tenant users read own expense exports"
  on public.expense_exports for select to authenticated
  using (tenant_id = public.current_company_id());

create policy "admins manage approval comments"
  on public.approval_comments for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "tenant users read own approval comments"
  on public.approval_comments for select to authenticated
  using (tenant_id = public.current_company_id());

create policy "tenant users comment as themselves"
  on public.approval_comments for insert to authenticated
  with check (tenant_id = public.current_company_id() and author_id = auth.uid());
