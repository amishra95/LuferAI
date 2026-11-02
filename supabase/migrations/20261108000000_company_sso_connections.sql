-- =============================================================================
-- Enterprise SSO (SAML) with just-in-time provisioning
-- -----------------------------------------------------------------------------
-- A company signs its employees in through its own identity provider (Okta,
-- Entra ID, Google Workspace…). The SAML connection itself lives in Supabase
-- Auth (`supabase sso add --type saml --metadata-url … --domains acme.com`);
-- this table links that provider to a company in Lufer.ai:
--
--   domain           the email domain the provider is registered for
--   sso_provider_id  the Supabase SSO provider's id (`supabase sso list`)
--   default_role     the corporate role a new employee gets on first sign-in
--
-- On first SSO sign-in (/auth/callback) someone without a membership gets one
-- in the company, as CLIENT with default_role, but only when their session
-- came from this exact provider (app_metadata.provider = 'sso:<id>') and their
-- email is on this domain. Without SSO, accounts still go through /signup and
-- an admin's approval.
--
-- Platform admins manage connections (service role writes); the company's own
-- users can see theirs on /governance.
-- =============================================================================

create table if not exists public.company_sso_connections (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  domain           text not null unique
                     check (domain = lower(domain) and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(domain) <= 253),
  sso_provider_id  uuid not null,
  default_role     public.corporate_role not null default 'ORGANIZER',
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.company_sso_connections is
  'Email domain → company for SAML SSO; first sign-in through sso_provider_id provisions a CLIENT membership with default_role. Service role writes only.';

create index if not exists company_sso_connections_company_idx on public.company_sso_connections (company_id);

drop trigger if exists company_sso_connections_set_updated_at on public.company_sso_connections;
create trigger company_sso_connections_set_updated_at
  before update on public.company_sso_connections
  for each row execute function public.set_updated_at();

alter table public.company_sso_connections enable row level security;
revoke all on public.company_sso_connections from anon, authenticated;
grant select on public.company_sso_connections to authenticated;

drop policy if exists "companies read their sso connections" on public.company_sso_connections;
create policy "companies read their sso connections" on public.company_sso_connections
  for select to authenticated
  using (company_id = (select public.current_company_id()));

drop policy if exists "platform admins read sso connections" on public.company_sso_connections;
create policy "platform admins read sso connections" on public.company_sso_connections
  for select to authenticated
  using ((select public.is_platform_admin()));
