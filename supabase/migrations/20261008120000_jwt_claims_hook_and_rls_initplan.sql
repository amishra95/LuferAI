-- =============================================================================
-- Custom access token claims + RLS evaluated once per statement
-- -----------------------------------------------------------------------------
-- 1. custom_access_token_hook: Supabase Auth calls this before issuing a JWT.
--    It copies the user's portal membership from platform_users (the single
--    source of truth; no separate roles table) into app_metadata.lufer, so the
--    app can route and gate on the token without a database round trip.
--    app_metadata can't be edited by users, and the hook overwrites it on every
--    issue, so a client can't forge or keep stale claims past a refresh.
--
-- 2. RLS stays on live platform_users lookups (current_company_id() etc.), so
--    revoking or changing a membership takes effect on the very next query,
--    not when the token expires. Claims are for the app's optimistic checks;
--    the database never trusts them for authorization.
--
-- 3. Every policy's helper calls are wrapped as (select fn()): Postgres then
--    evaluates them once per statement (an InitPlan) instead of once per row.
--    Same results, much less work on large tables.
--
-- Enabling the hook (not done by migrations):
--   local:  supabase/config.toml [auth.hook.custom_access_token] (enabled here)
--   hosted: Dashboard → Authentication → Hooks → Customize Access Token (JWT)
--           Claims → Postgres function public.custom_access_token_hook
-- =============================================================================

-- 1 · Hook ------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  app_metadata jsonb := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  member public.platform_users%rowtype;
  can_approve boolean;
begin
  select * into member from public.platform_users where user_id = (event ->> 'user_id')::uuid;

  if not found then
    -- No portal access: make sure no lufer claims survive from anywhere.
    app_metadata := app_metadata - 'lufer';
  else
    select exists (
      select 1 from public.approval_chains c
      where c.tenant_id = member.company_id and c.approver_user_id = member.user_id
    ) into can_approve;

    app_metadata := app_metadata || jsonb_build_object(
      'lufer', jsonb_strip_nulls(jsonb_build_object(
        'v', 1,
        'role', member.role,
        'company_id', member.company_id,
        'venue_id', member.venue_id,
        'partner_id', member.partner_id,
        'partner_role', member.partner_role,
        'corporate_role', member.corporate_role,
        'can_approve', member.role = 'CLIENT' and can_approve
      ))
    );
  end if;

  return jsonb_set(event, '{claims}', jsonb_set(claims, '{app_metadata}', app_metadata));
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth custom access token hook: adds app_metadata.lufer (portal role and scope) from platform_users.';

-- Only Supabase Auth may run the hook; API roles must not be able to call it.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

-- The hook runs as supabase_auth_admin, which is subject to RLS: let it read
-- exactly the two tables it needs, and nothing else.
grant select on table public.platform_users, public.approval_chains to supabase_auth_admin;

drop policy if exists "auth server reads memberships for token claims" on public.platform_users;
create policy "auth server reads memberships for token claims"
  on public.platform_users for select to supabase_auth_admin
  using (true);

drop policy if exists "auth server reads approval chains for token claims" on public.approval_chains;
create policy "auth server reads approval chains for token claims"
  on public.approval_chains for select to supabase_auth_admin
  using (true);

-- 2 · Evaluate helper calls once per statement ----------------------------------------
-- Rewrites each public policy's USING / WITH CHECK so bare calls such as
-- is_platform_admin() become (select is_platform_admin()). Calls already
-- wrapped are left alone, so re-running this is a no-op. Function names are
-- matched whole (rfp_sent_to_current_venue(...) is untouched).
do $$
declare
  p record;
  pattern constant text :=
    '(?<!SELECT )(?<![A-Za-z0-9_])((public\.)?(is_platform_admin|current_portal_role|current_company_id|current_venue_id|current_partner_id|current_partner_role)\(\)|auth\.uid\(\))';
  new_qual text;
  new_check text;
  sql text;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    new_qual := regexp_replace(p.qual, pattern, '(SELECT \1)', 'g');
    new_check := regexp_replace(p.with_check, pattern, '(SELECT \1)', 'g');
    if new_qual is distinct from p.qual or new_check is distinct from p.with_check then
      sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if p.qual is not null then sql := sql || format(' using (%s)', new_qual); end if;
      if p.with_check is not null then sql := sql || format(' with check (%s)', new_check); end if;
      execute sql;
    end if;
  end loop;
end
$$;
