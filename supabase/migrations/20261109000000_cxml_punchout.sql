-- =============================================================================
-- cXML PunchOut for procurement systems (Coupa, SAP Ariba, Oracle, Jaggaer)
-- -----------------------------------------------------------------------------
-- A buyer's procurement system opens Lufer.ai's catalogue from inside its own
-- requisition screen (PunchOutSetupRequest → /api/punchout/setup), the
-- employee fills a cart at /punchout/<token>, the cart goes back as a
-- PunchOutOrderMessage, and the approved purchase order arrives as an
-- OrderRequest (/api/punchout/order), matched line by line to that cart.
--
-- punchout_connections  one per buyer system: the Sender identity it sends and
--                       the SHA-256 of the shared secret (the secret is shown
--                       once, when an admin creates the connection).
-- punchout_sessions     one per shopping trip: who, where to post the cart
--                       back, the cart. The start-page token is stored hashed.
-- punchout_orders       purchase orders received, idempotent on payloadID,
--                       with each line's match against the cart.
--
-- All writes are service role. The company reads its own connections and
-- orders; admins read everything. Sessions hold buyer cookies: service only.
-- =============================================================================

create table if not exists public.punchout_connections (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  label                 text not null check (char_length(label) between 1 and 80),
  sender_identity       text not null unique check (char_length(sender_identity) between 1 and 200),
  shared_secret_sha256  text not null check (shared_secret_sha256 ~ '^[0-9a-f]{64}$'),
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.punchout_connections is
  'A buyer procurement system allowed to punch out to Lufer.ai: its cXML Sender identity and the SHA-256 of its shared secret. Service role writes only.';

create index if not exists punchout_connections_company_idx on public.punchout_connections (company_id);

create table if not exists public.punchout_sessions (
  id                 uuid primary key default gen_random_uuid(),
  connection_id      uuid not null references public.punchout_connections (id) on delete cascade,
  company_id         uuid not null references public.companies (id) on delete cascade,
  token_sha256       text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  operation          text not null default 'create' check (operation in ('create', 'edit', 'inspect')),
  buyer_cookie       text not null check (char_length(buyer_cookie) <= 512),
  browser_form_post  text not null check (browser_form_post ~ '^https://'),
  user_email         text,
  user_name          text,
  -- [{ "itemId", "name", "quantity", "unitPrice", "taxCode" }]
  cart               jsonb not null default '[]'::jsonb check (jsonb_typeof(cart) = 'array'),
  expires_at         timestamptz not null,
  returned_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.punchout_sessions is
  'One punchout shopping trip: the buyer system''s cookie, where the cart is posted back, and the cart. Token stored as SHA-256. Service role only.';

create index if not exists punchout_sessions_connection_idx on public.punchout_sessions (connection_id, created_at desc);

create table if not exists public.punchout_orders (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.punchout_connections (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  payload_id     text not null check (char_length(payload_id) <= 300),
  order_id       text not null check (char_length(order_id) <= 120),
  order_type     text not null default 'new',
  order_date     text,
  total_inr      numeric(14,2),
  -- [{ lineNumber, itemId, quantity, unitPrice, description, ok, issue? }]
  lines          jsonb not null check (jsonb_typeof(lines) = 'array'),
  -- received: every line matched its cart; needs_review: at least one didn't.
  status         text not null check (status in ('received', 'needs_review', 'fulfilled', 'rejected')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (connection_id, payload_id)
);

comment on table public.punchout_orders is
  'Purchase orders received over cXML (OrderRequest), idempotent per connection and payloadID, with each line matched to its punchout cart. Service role writes only.';

create index if not exists punchout_orders_company_idx on public.punchout_orders (company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['punchout_connections', 'punchout_sessions', 'punchout_orders'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%s enable row level security', t);
    execute format('revoke all on public.%s from anon, authenticated', t);
  end loop;
end
$$;

-- Not the secret's hash: readers see which systems are connected, nothing that authenticates.
grant select (id, company_id, label, sender_identity, enabled, created_at, updated_at) on public.punchout_connections to authenticated;
grant select on public.punchout_orders to authenticated;

drop policy if exists "companies read their punchout connections" on public.punchout_connections;
create policy "companies read their punchout connections" on public.punchout_connections
  for select to authenticated
  using (company_id = (select public.current_company_id()) or (select public.is_platform_admin()));

drop policy if exists "companies read their punchout orders" on public.punchout_orders;
create policy "companies read their punchout orders" on public.punchout_orders
  for select to authenticated
  using (company_id = (select public.current_company_id()) or (select public.is_platform_admin()));
