-- =============================================================================
-- OAuth token vault
-- -----------------------------------------------------------------------------
-- Platform-level OAuth credentials for expense/ERP providers whose access
-- tokens expire (Zoho Expense, ERPNext over OAuth). Tokens are encrypted by the
-- app with AES-256-GCM (lib/auth/oauth-vault.ts) under OAUTH_VAULT_KEY, which
-- never reaches the database: a leaked row or backup holds only ciphertext.
--
-- lib/auth/token-rotator.ts refreshes tokens expiring within 10 minutes
-- (/api/cron/rotate-oauth-tokens, and on use). `version` guards concurrent
-- refreshes: a writer updates only the version it read.
--
-- Only the service role touches this table: RLS is on with no policies, and the
-- API roles' default grants are revoked.
-- =============================================================================

create table if not exists public.oauth_credentials (
  provider                 text primary key check (provider in ('zoho', 'erpnext')),
  encrypted_access_token   text not null check (encrypted_access_token like 'v1.%'),
  encrypted_refresh_token  text check (encrypted_refresh_token is null or encrypted_refresh_token like 'v1.%'),
  expires_at               timestamptz,
  -- The provider's own account id (Zoho's X-com-zoho-expense-organizationid), not a tenant.
  organization_id          text,
  version                  integer not null default 1 check (version >= 1),
  refreshed_at             timestamptz,
  -- The last refresh failure, cleared by the next success. Never contains a token.
  last_error               text check (last_error is null or length(last_error) <= 500),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.oauth_credentials is
  'Encrypted OAuth tokens for expense/ERP providers (AES-256-GCM, key held by the app). Service role only.';

drop trigger if exists oauth_credentials_set_updated_at on public.oauth_credentials;
create trigger oauth_credentials_set_updated_at
  before update on public.oauth_credentials
  for each row execute function public.set_updated_at();

alter table public.oauth_credentials enable row level security;
revoke all on public.oauth_credentials from anon, authenticated;
