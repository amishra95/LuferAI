/**
 * Applies every migration to an in-process Postgres (PGlite) and checks, as
 * each kind of user: RLS coverage, tenant isolation, that forged JWT claims are
 * ignored by the database, instant revocation, the custom access token hook and
 * its permissions, and that policy helpers run once per statement.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const U = {
  admin: "a0000000-0000-4000-8000-000000000001",
  client: "a0000000-0000-4000-8000-000000000002",
  approver: "a0000000-0000-4000-8000-000000000003",
  property: "a0000000-0000-4000-8000-000000000004",
  stranger: "a0000000-0000-4000-8000-000000000005",
};

let db;
let venueId;

before(async () => {
  db = await createDatabase();
  venueId = (await db.query(`select venue_id from bookings where company_id = $1 limit 1`, [NIMBUS])).rows[0].venue_id;
  for (const [name, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`]);
  await db.query(
    `insert into platform_users (user_id, role, company_id, venue_id, corporate_role) values
       ($1, 'ADMIN', null, null, null),
       ($2, 'CLIENT', $5, null, 'ORGANIZER'),
       ($3, 'CLIENT', $5, null, 'APPROVER'),
       ($4, 'PROPERTY', null, $6, null)`,
    [U.admin, U.client, U.approver, U.property, NIMBUS, venueId]
  );
  await db.query(`insert into approval_chains (tenant_id, approver_user_id, tier_level) values ($1, $2, 1)`, [NIMBUS, U.approver]);
});

const as = (user, fn, extraClaims = {}) => asUser(db, { claims: { sub: user, ...extraClaims } }, fn);
const count = async (tx, sql, params) => Number((await tx.query(sql, params)).rows[0].n);

test("every public table has RLS enabled", async () => {
  const { rows } = await db.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(rows, []);
});

test("anon and users without a membership see no tenant data", async () => {
  for (const tbl of ["bookings", "companies", "platform_users", "payments", "booking_approvals", "channel_messages"]) {
    const anon = await asUser(db, { role: "anon" }, (tx) => count(tx, `select count(*) n from ${tbl}`));
    const stranger = await as(U.stranger, (tx) => count(tx, `select count(*) n from ${tbl}`));
    assert.equal(anon, 0, `anon ${tbl}`);
    assert.equal(stranger, 0, `stranger ${tbl}`);
  }
});

test("clients see only their company; venues only their own, minus pending approvals; admins everything", async () => {
  const total = await count(db, `select count(*) n from bookings`);
  const nimbus = await count(db, `select count(*) n from bookings where company_id = $1`, [NIMBUS]);
  const atVenue = await count(db, `select count(*) n from bookings where venue_id = $1 and status <> 'PENDING_APPROVAL'`, [venueId]);
  assert.ok(nimbus > 0 && nimbus < total, "seed has bookings for more than one company");

  assert.equal(await as(U.client, (tx) => count(tx, `select count(*) n from bookings`)), nimbus);
  assert.equal(await as(U.client, (tx) => count(tx, `select count(*) n from bookings where company_id = $1`, [VERTEX])), 0);
  assert.equal(await as(U.client, (tx) => count(tx, `select count(*) n from companies`)), 1);
  assert.equal(await as(U.property, (tx) => count(tx, `select count(*) n from bookings`)), atVenue);
  assert.equal(await as(U.admin, (tx) => count(tx, `select count(*) n from bookings`)), total);
});

test("zero trust: forged JWT claims grant nothing; the database checks platform_users", async () => {
  const forged = { app_metadata: { lufer: { role: "ADMIN", company_id: VERTEX } }, role: "authenticated" };
  const nimbus = await count(db, `select count(*) n from bookings where company_id = $1`, [NIMBUS]);
  assert.equal(await as(U.client, (tx) => count(tx, `select count(*) n from bookings`), forged), nimbus);
  assert.equal(await as(U.stranger, (tx) => count(tx, `select count(*) n from bookings`), forged), 0);
});

test("clients can't write into another tenant", async () => {
  // Bookings: the GST trigger runs first and, under the client's RLS, can't even see the other company.
  await assert.rejects(
    as(U.client, (tx) =>
      tx.query(
        `insert into bookings (company_id, venue_id, party_size, budget_per_head_inr, total_amount_inr, event_date, cost_center)
         values ($1, $2, 10, 1000, 10000, current_date + 30, 'X')`,
        [VERTEX, venueId]
      )
    ),
    /not found|row-level security/
  );
  // A table without such a trigger: the policy's WITH CHECK rejects it.
  await assert.rejects(
    as(U.client, (tx) => tx.query(`insert into departments (company_id, name, annual_budget_inr) values ($1, 'Smuggled', 1)`, [VERTEX])),
    /row-level security/
  );
  const updated = await as(U.client, async (tx) => (await tx.query(`update companies set primary_contact_email = 'x@y.z' where id = $1 returning id`, [VERTEX])).rows.length);
  assert.equal(updated, 0);
});

test("revoking a membership takes effect on the next query, whatever the token says", async () => {
  await db.transaction(async (tx) => {
    const claims = JSON.stringify({ role: "authenticated", sub: U.client, app_metadata: { lufer: { role: "CLIENT", company_id: NIMBUS } } });
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.exec(`set local role authenticated`);
    assert.ok(Number((await tx.query(`select count(*) n from bookings`)).rows[0].n) > 0);
    await tx.exec(`reset role`);
    await tx.query(`delete from platform_users where user_id = $1`, [U.client]);
    await tx.exec(`set local role authenticated`);
    assert.equal(Number((await tx.query(`select count(*) n from bookings`)).rows[0].n), 0);
    await tx.rollback();
  });
});

// --- custom access token hook ------------------------------------------------------

const hook = (userId, claims = {}) =>
  asUser(db, { role: "supabase_auth_admin" }, async (tx) => {
    const event = { user_id: userId, authentication_method: "password", claims: { sub: userId, role: "authenticated", aud: "authenticated", ...claims } };
    return (await tx.query(`select public.custom_access_token_hook($1::jsonb) as e`, [JSON.stringify(event)])).rows[0].e;
  });

test("hook: adds the member's role and scope under app_metadata.lufer, keeping other claims", async () => {
  const out = await hook(U.approver, { app_metadata: { provider: "email" }, email: "approver@example.test" });
  assert.equal(out.user_id, U.approver);
  assert.equal(out.claims.email, "approver@example.test");
  assert.equal(out.claims.role, "authenticated");
  assert.equal(out.claims.app_metadata.provider, "email");
  assert.deepEqual(out.claims.app_metadata.lufer, { v: 1, role: "CLIENT", company_id: NIMBUS, corporate_role: "APPROVER", can_approve: true });

  assert.deepEqual((await hook(U.client)).claims.app_metadata.lufer, { v: 1, role: "CLIENT", company_id: NIMBUS, corporate_role: "ORGANIZER", can_approve: false });
  assert.deepEqual((await hook(U.admin)).claims.app_metadata.lufer, { v: 1, role: "ADMIN", can_approve: false });
  assert.deepEqual((await hook(U.property)).claims.app_metadata.lufer, { v: 1, role: "PROPERTY", venue_id: venueId, can_approve: false });
});

test("hook: users without a membership get no lufer claims, even if some were passed in", async () => {
  const out = await hook(U.stranger, { app_metadata: { provider: "google", lufer: { role: "ADMIN" } } });
  assert.deepEqual(out.claims.app_metadata, { provider: "google" });
});

test("hook: only Supabase Auth can run it, and it can read nothing beyond memberships", async () => {
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(
      asUser(db, { role, claims: { sub: U.admin } }, (tx) => tx.query(`select public.custom_access_token_hook('{}'::jsonb)`)),
      /permission denied/,
      role
    );
  }
  await assert.rejects(asUser(db, { role: "supabase_auth_admin" }, (tx) => tx.query(`select count(*) from bookings`)), /permission denied/);
});

// --- policies evaluated once per statement ----------------------------------------------

const BARE_CALL = /(?<!SELECT )(?<![A-Za-z0-9_])(?:public\.)?(?:is_platform_admin|current_portal_role|current_company_id|current_venue_id|current_partner_id|current_partner_role)\(\)|(?<!SELECT )auth\.uid\(\)/;

test("every policy wraps its helper calls as (select fn()), and re-running the migration changes nothing", async () => {
  const policies = async () => (await db.query(`select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`)).rows;
  const before = await policies();
  const bare = before.filter((p) => BARE_CALL.test(p.qual ?? "") || BARE_CALL.test(p.with_check ?? ""));
  assert.deepEqual(bare.map((p) => `${p.tablename}: ${p.policyname}`), []);
  // Function-call arguments are left alone.
  assert.ok(before.some((p) => (p.qual ?? "").includes("rfp_sent_to_current_venue(")));

  await db.exec(readFileSync(new URL("../supabase/migrations/20261008120000_jwt_claims_hook_and_rls_initplan.sql", import.meta.url), "utf8"));
  assert.deepEqual(await policies(), before);
});

test("the planner evaluates helpers once per statement (InitPlan), not per row", async () => {
  const plan = await as(U.client, async (tx) => (await tx.query(`explain select * from bookings`)).rows.map((r) => r["QUERY PLAN"]).join("\n"));
  assert.match(plan, /InitPlan/);
});
