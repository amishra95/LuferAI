/**
 * In-process Postgres (PGlite) with the pieces of Supabase the migrations rely
 * on: the auth schema (users, uid(), jwt()), the API roles, the extensions
 * schema and Supabase's default grants. Used by tests/rls.test.mjs to apply
 * every migration and exercise RLS as each kind of user.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const ROOT = new URL("../../", import.meta.url).pathname;

const BOOTSTRAP = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin nologin noinherit;
create schema if not exists extensions;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
-- As in Supabase: claims come from the request's JWT, set per transaction by PostgREST.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema public, extensions to anon, authenticated, service_role;
-- Supabase grants table access broadly and relies on RLS to restrict it.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export async function createDatabase({ seed = true } = {}) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(BOOTSTRAP);
  const dir = join(ROOT, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(dir, file), "utf8"));
    } catch (err) {
      err.message = `${file}: ${err.message}`;
      throw err;
    }
  }
  if (seed) await db.exec(readFileSync(join(ROOT, "supabase/seed.sql"), "utf8"));
  return db;
}

/**
 * Runs `fn` as an API request would: in a transaction, as `role`, with the
 * given JWT claims. Rolled back afterwards so tests don't leak state.
 */
export async function asUser(db, { role = "authenticated", claims = {} }, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, ...claims })]);
    await tx.exec(`set local role ${role}`);
    const result = await fn(tx);
    await tx.rollback();
    return result;
  });
}
