-- =============================================================================
-- CRM deals: tie entertainment spend to the sales it was for
-- -----------------------------------------------------------------------------
-- A company's sales deals (opportunities), imported from its CRM (a CSV export
-- from Zoho CRM, HubSpot or Salesforce, or entered by hand), and the bookings
-- that entertained each deal's client. /client/roi shows spend per deal, won
-- revenue against that spend and the win rate of entertained deals
-- (lib/crm/roi.ts).
--
-- (provider, external_id) is the CRM's own deal id, so re-importing the same
-- export updates deals instead of duplicating them. A booking supports at most
-- one deal (bookings.crm_deal_id); the trigger keeps it inside the booking's
-- company. Writes go through the service role only (the portal's server
-- actions check the member's company and role); the company and admins read.
-- =============================================================================

create table if not exists public.crm_deals (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  provider      text not null default 'manual' check (provider in ('manual', 'zoho', 'hubspot', 'salesforce')),
  external_id   text not null check (char_length(external_id) between 1 and 120),
  name          text not null check (char_length(trim(name)) between 1 and 200),
  account_name  text check (account_name is null or char_length(account_name) <= 200),
  amount_inr    numeric(16,2) not null default 0 check (amount_inr >= 0),
  stage         text not null default 'open' check (stage in ('open', 'won', 'lost')),
  closed_on     date,
  owner_email   text check (owner_email is null or char_length(owner_email) <= 254),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, provider, external_id)
);

comment on table public.crm_deals is
  'A company''s sales deals from its CRM, for tying entertainment spend to revenue. Service role writes only.';

create index if not exists crm_deals_company_idx on public.crm_deals (company_id, stage);

drop trigger if exists crm_deals_set_updated_at on public.crm_deals;
create trigger crm_deals_set_updated_at
  before update on public.crm_deals
  for each row execute function public.set_updated_at();

alter table public.crm_deals enable row level security;
revoke all on public.crm_deals from anon, authenticated;
grant select on public.crm_deals to authenticated;

drop policy if exists "company members read their deals" on public.crm_deals;
create policy "company members read their deals" on public.crm_deals
  for select to authenticated
  using (company_id = (select public.current_company_id()));

drop policy if exists "platform admins read deals" on public.crm_deals;
create policy "platform admins read deals" on public.crm_deals
  for select to authenticated
  using ((select public.is_platform_admin()));

-- bookings.crm_deal_id --------------------------------------------------------------
alter table public.bookings add column if not exists crm_deal_id uuid references public.crm_deals (id) on delete set null;
create index if not exists bookings_crm_deal_idx on public.bookings (crm_deal_id) where crm_deal_id is not null;

comment on column public.bookings.crm_deal_id is 'The sales deal this booking entertained for (crm_deals), same company only.';

create or replace function public.bookings_check_crm_deal()
returns trigger
language plpgsql
as $$
begin
  if new.crm_deal_id is not null and not exists (
    select 1 from public.crm_deals d where d.id = new.crm_deal_id and d.company_id = new.company_id
  ) then
    raise exception 'Deal % does not belong to the booking''s company', new.crm_deal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_check_crm_deal on public.bookings;
create trigger bookings_check_crm_deal
  before insert or update of crm_deal_id, company_id on public.bookings
  for each row execute function public.bookings_check_crm_deal();
