-- =============================================================================
-- 0033 · Department spend policies and corporate virtual cards
-- -----------------------------------------------------------------------------
-- department_policies   Per-department overrides of corporate_policies: a per-head
--                       cap and a senior (VP) sign-off threshold. The stricter of the
--                       company and department rule applies (lib/policies). Requests
--                       over either go through the existing approval chain.
-- virtual_cards         Single-use cards issued for an approved booking, bounded by its
--                       approved invoice total. Only an opaque provider token and the
--                       last four digits are stored, never a card number. Receipts sync
--                       to the company's expense system (lib/finance/expense-adapters.ts)
--                       when the booking is confirmed.
--                         active ─► used | expired | cancelled
--
-- Clients read their company's rows, admins everything; the app writes through the
-- service role (lib/finance/virtual-cards.ts, lib/policies).
-- =============================================================================

-- 1 · Department policies ---------------------------------------------------------------------
create table if not exists public.department_policies (
  department_id              uuid primary key,
  tenant_id                  uuid not null references public.companies (id) on delete cascade,
  max_budget_per_head_inr    numeric(14,2) check (max_budget_per_head_inr is null or max_budget_per_head_inr > 0),
  senior_approval_above_inr  numeric(14,2) check (senior_approval_above_inr is null or senior_approval_above_inr > 0),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint department_policies_department_fkey
    foreign key (department_id, tenant_id) references public.departments (id, company_id) on delete cascade
);

comment on table public.department_policies is 'Per-department per-head cap and senior sign-off threshold, on top of corporate_policies.';
comment on column public.department_policies.max_budget_per_head_inr is 'Per-head cap, pre-GST. Over it needs sign-off. Null = company rule only.';
comment on column public.department_policies.senior_approval_above_inr is 'Booking total (pre-GST) above which a senior (tier 2) sign-off is needed. Null = company rule only.';

create trigger department_policies_set_updated_at
  before update on public.department_policies
  for each row execute function public.set_updated_at();

-- 2 · Virtual cards ---------------------------------------------------------------------------
create table if not exists public.virtual_cards (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.companies (id) on delete cascade,
  booking_id           uuid not null,
  provider             text not null check (provider in ('sandbox')),
  provider_card_id     text not null check (char_length(provider_card_id) between 1 and 120),
  -- Opaque issuer token for the card, never a PAN.
  card_token           text not null check (char_length(card_token) between 8 and 200),
  last4                char(4) not null check (last4 ~ '^[0-9]{4}$'),
  amount_limit_inr     numeric(14,2) not null check (amount_limit_inr > 0),
  currency             char(3) not null default 'INR' check (currency = 'INR'),
  single_use           boolean not null default true,
  status               text not null default 'active' check (status in ('active', 'used', 'expired', 'cancelled')),
  expires_at           timestamptz not null,
  issued_by            uuid references auth.users (id) on delete set null,
  expense_sync_status  text not null default 'awaiting_confirmation'
                         check (expense_sync_status in ('awaiting_confirmation', 'synced', 'mocked', 'failed')),
  expense_synced_at    timestamptz,
  expense_error        text check (expense_error is null or char_length(expense_error) <= 500),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint virtual_cards_booking_fkey
    foreign key (booking_id, tenant_id) references public.bookings (id, company_id) on delete cascade,
  constraint virtual_cards_provider_card_key unique (provider, provider_card_id),
  constraint virtual_cards_card_token_key unique (card_token)
);

comment on table public.virtual_cards is 'Single-use corporate cards per approved booking: issuer token and last four only.';

-- At most one usable card per booking.
create unique index if not exists virtual_cards_one_active_per_booking on public.virtual_cards (booking_id) where status = 'active';
create index if not exists virtual_cards_tenant_idx on public.virtual_cards (tenant_id, created_at desc);

create trigger virtual_cards_set_updated_at
  before update on public.virtual_cards
  for each row execute function public.set_updated_at();

-- 3 · RLS -------------------------------------------------------------------------------------
alter table public.department_policies enable row level security;
alter table public.virtual_cards enable row level security;

create policy "admins read department policies"
  on public.department_policies for select to authenticated
  using ((select public.is_platform_admin()));

create policy "tenant users read own department policies"
  on public.department_policies for select to authenticated
  using (tenant_id = (select public.current_company_id()));

create policy "admins read virtual cards"
  on public.virtual_cards for select to authenticated
  using ((select public.is_platform_admin()));

create policy "tenant users read own virtual cards"
  on public.virtual_cards for select to authenticated
  using (tenant_id = (select public.current_company_id()));
