-- =============================================================================
-- Purge demo and test data from a database (run via scripts/purge-demo-data.mjs)
-- -----------------------------------------------------------------------------
-- Removes what supabase/seed.sql and the e2e suite put in a hosted project, so
-- production starts clean:
--   * seed companies (1111…, 2222…) and venues (aaaaaaaa-…) and everything that
--     depends on them: bookings (incl. test bookings made against them),
--     payments, policies, rate cards, POs, holds, menus, workspaces, …
--   * venue onboarding requests from the seed (*.example contacts)
--   * test accounts: auth users on *.example or @lufer.test, their
--     platform_users rows and any partner they alone belong to
--   * pre-launch logs (payment webhook events, AI token usage), only while no
--     real company or booking exists
--
-- Real accounts are never targeted, and the script aborts if any user outside
-- those test domains would lose their platform_users row.
--
-- Dependents are found from the catalog (pg_constraint), not a hand-kept list:
-- child rows are deleted before their parents, so ON DELETE RESTRICT foreign
-- keys can't stop it half-way. Append-only tables (contract signatures, audit
-- trails, issued invoices) raise if they hold rows for these records; the whole
-- run then rolls back.
--
-- DRY RUN unless purge.apply = 'on': everything is deleted, the report is
-- built, then an exception rolls the transaction back and carries the report.
-- Tested against every migration + seed in tests/purge-demo-data.test.mjs.
-- =============================================================================

create or replace function pg_temp.purge(tbl regclass, cond text, depth int, report inout text)
language plpgsql as $fn$
declare
  fk record;
  n bigint;
begin
  if depth > 8 then
    raise exception 'purge: foreign keys nested deeper than 8 under %', tbl;
  end if;
  -- Children first, for every single-column FK that would block or cascade
  -- (SET NULL / SET DEFAULT children are left for Postgres to update).
  for fk in
    select c.conrelid::regclass as child, ca.attname as child_col, pa.attname as parent_col
    from pg_constraint c
    join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    join pg_class cc on cc.oid = c.conrelid
    where c.contype = 'f' and c.confrelid = tbl and cardinality(c.conkey) = 1
      and c.confdeltype in ('a', 'r', 'c')
      and c.conrelid <> tbl
      -- Supabase's own auth.* children (sessions, identities, …) are left to
      -- their ON DELETE CASCADE, which runs with the owner's rights.
      and cc.relnamespace = 'public'::regnamespace
  loop
    report := pg_temp.purge(
      fk.child,
      format('%I in (select %I from %s where %s)', fk.child_col, fk.parent_col, tbl, cond),
      depth + 1,
      report
    );
  end loop;
  execute format('delete from %s where %s', tbl, cond);
  get diagnostics n = row_count;
  if n > 0 then
    report := report || format(E'\n  %s.%s: %s',
      (select nspname from pg_namespace where oid = (select relnamespace from pg_class where oid = tbl)),
      (select relname from pg_class where oid = tbl), n);
  end if;
end;
$fn$;

-- Top-level targets are resolved to ids before anything is deleted: a condition
-- that looks at other rows (e.g. "partners whose members are test accounts")
-- would otherwise see those rows already gone by the time it runs.
create or replace function pg_temp.purge_ids(tbl regclass, cond text, report inout text)
language plpgsql as $fn$
declare
  ids uuid[];
begin
  execute format('select array_agg(id) from %s where %s', tbl, cond) into ids;
  if ids is not null then
    report := pg_temp.purge(tbl, format('id = any(%L::uuid[])', ids), 0, report);
  end if;
end;
$fn$;

-- Row counts of every public table plus auth.users. The report diffs a snapshot
-- from before and after, so rows removed by Postgres's own ON DELETE CASCADE
-- are counted too, not just the deletes this script issues.
create or replace function pg_temp.row_counts() returns jsonb
language plpgsql as $fn$
declare
  t record;
  n bigint;
  counts jsonb := '{}';
begin
  for t in select c.oid::regclass as tbl, n2.nspname || '.' || c.relname as name
           from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
           where c.relkind = 'r' and (n2.nspname = 'public' or (n2.nspname = 'auth' and c.relname = 'users'))
  loop
    execute format('select count(*) from %s', t.tbl) into n;
    counts := counts || jsonb_build_object(t.name, n);
  end loop;
  return counts;
end;
$fn$;

do $purge$
declare
  apply boolean := coalesce(current_setting('purge.apply', true), '') = 'on';
  report text := 'Deleted:';
  test_user text := $$(email ilike '%.example' or email ilike '%@lufer.test')$$;
  real_members_before bigint;
  real_members_after bigint;
  seed_companies text := $$('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$;
  seed_venues text := $$(id::text like 'aaaaaaaa-%')$$;
  before_counts jsonb := pg_temp.row_counts();
  after_counts jsonb;
  t record;
begin
  execute format('select count(*) from public.platform_users p join auth.users u on u.id = p.user_id where not %s', test_user)
    into real_members_before;

  -- Partners whose only members are test accounts (e.g. "E2E Test Partner").
  report := pg_temp.purge_ids('public.partners'::regclass, format(
    'id in (select p.partner_id from public.platform_users p join auth.users u on u.id = p.user_id where p.partner_id is not null and %1$s)
     and id not in (select p.partner_id from public.platform_users p join auth.users u on u.id = p.user_id where p.partner_id is not null and not %1$s)',
    test_user), report);

  -- Test accounts (platform_users rows cascade from auth.users).
  report := pg_temp.purge_ids('auth.users'::regclass, test_user, report);

  -- Seed companies and venues, with every booking, payment, policy, … under them.
  report := pg_temp.purge_ids('public.companies'::regclass, format('id in %s', seed_companies), report);
  report := pg_temp.purge_ids('public.venues'::regclass, seed_venues, report);
  report := pg_temp.purge_ids('public.venue_onboarding_requests'::regclass, $$contact_email ilike '%.example'$$, report);

  -- Logs recorded while testing (payment webhooks, AI token usage) have no link
  -- to a company, so they can only be told apart by timing: clear them only while
  -- no real company or booking exists, i.e. before launch. Re-running this script
  -- after launch leaves them alone.
  if not exists (select 1 from public.companies) and not exists (select 1 from public.bookings) then
    report := pg_temp.purge('public.payment_events'::regclass, 'true', 0, report);
    report := pg_temp.purge('public.agent_execution_logs'::regclass, 'true', 0, report);
  end if;

  execute format('select count(*) from public.platform_users p join auth.users u on u.id = p.user_id where not %s', test_user)
    into real_members_after;
  if real_members_after <> real_members_before then
    raise exception 'purge aborted: % real account(s) would lose access (% before, % after)',
      real_members_before - real_members_after, real_members_before, real_members_after;
  end if;
  -- Before → after for every table that changed, then what's left, so a reviewer
  -- can check nothing else was touched and nothing demo-related survived.
  after_counts := pg_temp.row_counts();
  report := 'Deleted:';
  for t in select key, (before_counts ->> key)::bigint as was, (after_counts ->> key)::bigint as now
           from jsonb_object_keys(before_counts) key order by key loop
    if t.was <> t.now then
      report := report || format(E'\n  %s: %s', t.key, t.was - t.now);
    end if;
  end loop;
  report := report || E'\nLeft in place:';
  for t in select key, (after_counts ->> key)::bigint as now from jsonb_object_keys(after_counts) key order by key loop
    if t.now > 0 then
      report := report || format(E'\n  %s: %s', t.key, t.now);
    end if;
  end loop;
  report := report || format(E'\nReal accounts kept: %s', real_members_after);

  if not apply then
    raise exception using message = 'DRY RUN, nothing was changed. ' || report, hint = 'purge_dry_run';
  end if;
  perform set_config('purge.report', report, false);
end;
$purge$;

select current_setting('purge.report', true) as report;
