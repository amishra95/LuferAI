import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createDatabase } from "./support/supabase-pglite.mjs";

const SCRIPT = readFileSync(new URL("../supabase/scripts/purge-demo-data.sql", import.meta.url), "utf8");
const NIMBUS = "11111111-1111-4111-8111-111111111111";
const COPPER = "aaaaaaaa-0001-4000-8000-000000000001";

const U = {
  realAdmin: "d0000000-0000-4000-8000-000000000001",
  realAdmin2: "d0000000-0000-4000-8000-000000000002",
  seedClient: "d0000000-0000-4000-8000-000000000003",
  e2eClient: "d0000000-0000-4000-8000-000000000004",
  e2eAdmin: "d0000000-0000-4000-8000-000000000005",
  e2ePartner: "d0000000-0000-4000-8000-000000000006",
};

/** Production as it was found: seed data, e2e accounts and leftovers, plus real admins. */
async function productionLike() {
  const db = await createDatabase();
  const emails = {
    realAdmin: "founder@gmail.com",
    realAdmin2: "ops@gmail.com",
    seedClient: "priya@nimbusanalytics.example",
    e2eClient: "buyer@lufer.test",
    e2eAdmin: "admin@lufer.test",
    e2ePartner: "partner@lufer.test",
  };
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, emails[k]]);
  const partner = (await db.query(`insert into public.partners (name, slug) values ('E2E Test Partner', 'e2e-test-partner') returning id`)).rows[0].id;
  await db.query(
    `insert into platform_users (user_id, role, company_id, venue_id, partner_id, partner_role, corporate_role) values
       ($1, 'ADMIN', null, null, null, null, null),
       ($2, 'ADMIN', null, null, null, null, null),
       ($3, 'CLIENT', $7, null, null, null, 'ORGANIZER'),
       ($4, 'CLIENT', $7, null, null, null, 'ORGANIZER'),
       ($5, 'ADMIN', null, null, null, null, null),
       ($6, 'PARTNER', null, null, $8, 'OWNER', null)`,
    [U.realAdmin, U.realAdmin2, U.seedClient, U.e2eClient, U.e2eAdmin, U.e2ePartner, NIMBUS, partner],
  );
  await db.query(`insert into approval_chains (tenant_id, approver_user_id, tier_level) values ($1, $2, 1)`, [NIMBUS, U.seedClient]);
  // A test booking made through the app against seed data.
  await db.query(
    `insert into bookings (company_id, venue_id, party_size, budget_per_head_inr, total_amount_inr, status, event_date)
     values ($1, $2, 30, 4950, 148500, 'PENDING', '2026-12-01')`,
    [NIMBUS, COPPER],
  );
  return db;
}

const count = async (db, sql) => Number((await db.query(sql)).rows[0].n);

async function snapshot(db) {
  return {
    companies: await count(db, `select count(*) n from companies`),
    venues: await count(db, `select count(*) n from venues`),
    bookings: await count(db, `select count(*) n from bookings`),
    users: await count(db, `select count(*) n from auth.users`),
    members: await count(db, `select count(*) n from platform_users`),
    partners: await count(db, `select count(*) n from partners`),
    onboarding: await count(db, `select count(*) n from venue_onboarding_requests`),
    gstCodes: await count(db, `select count(*) n from gst_state_codes`),
  };
}

test("dry run reports what it would delete and changes nothing", async () => {
  const db = await productionLike();
  const before = await snapshot(db);
  await assert.rejects(db.exec(SCRIPT), (err) => {
    assert.match(err.message, /^DRY RUN, nothing was changed\. Deleted:/);
    assert.match(err.message, /public\.bookings: 4/);
    assert.match(err.message, /public\.companies: 2/);
    assert.match(err.message, /public\.venues: 5/);
    assert.match(err.message, /auth\.users: 4/);
    assert.match(err.message, /public\.partners: 1/);
    assert.match(err.message, /Real accounts kept: 2/);
    return true;
  });
  assert.deepEqual(await snapshot(db), before);
});

test("apply removes seed data, test accounts and their partner, and keeps real admins and reference data", async () => {
  const db = await productionLike();
  const gstCodes = await count(db, `select count(*) n from gst_state_codes`);
  await db.exec(`select set_config('purge.apply', 'on', false);\n${SCRIPT}`);

  const after = await snapshot(db);
  assert.deepEqual(after, { companies: 0, venues: 0, bookings: 0, users: 2, members: 2, partners: 0, onboarding: 0, gstCodes });
  const kept = (await db.query(`select u.email, p.role from auth.users u join platform_users p on p.user_id = u.id order by u.email`)).rows;
  assert.deepEqual(kept, [
    { email: "founder@gmail.com", role: "ADMIN" },
    { email: "ops@gmail.com", role: "ADMIN" },
  ]);
  // Every table that hung off the seed companies and venues is empty too.
  for (const tbl of ["corporate_policies", "corporate_rate_cards", "departments", "inventory_holds", "purchase_orders", "po_allocations", "venue_menu_packages", "approval_chains"]) {
    assert.equal(await count(db, `select count(*) n from ${tbl}`), 0, tbl);
  }
});

test("aborts and changes nothing if a real account belongs to a seed company", async () => {
  const db = await productionLike();
  const real = "d0000000-0000-4000-8000-000000000009";
  await db.query(`insert into auth.users (id, email) values ($1, 'cfo@realcompany.in')`, [real]);
  await db.query(`insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $2, 'APPROVER')`, [real, NIMBUS]);
  const before = await snapshot(db);
  await assert.rejects(db.exec(`select set_config('purge.apply', 'on', false);\n${SCRIPT}`), /purge aborted: 1 real account\(s\) would lose access/);
  assert.deepEqual(await snapshot(db), before);
});

test("a partner shared with a real account is kept", async () => {
  const db = await productionLike();
  const real = "d0000000-0000-4000-8000-000000000010";
  const partner = (await db.query(`select partner_id from platform_users where user_id = $1`, [U.e2ePartner])).rows[0].partner_id;
  await db.query(`insert into auth.users (id, email) values ($1, 'owner@realcaterer.in')`, [real]);
  await db.query(`insert into platform_users (user_id, role, partner_id, partner_role) values ($1, 'PARTNER', $2, 'MANAGER')`, [real, partner]);
  await db.exec(`select set_config('purge.apply', 'on', false);\n${SCRIPT}`);
  assert.equal(await count(db, `select count(*) n from partners`), 1);
  assert.equal(await count(db, `select count(*) n from platform_users where user_id = '${real}'`), 1);
});

test("pre-launch logs are cleared only while no real company or booking exists", async () => {
  const log = `insert into payment_events (provider, event_id, event_type, payload) values ('razorpay', $1, 'payment.authorized', '{}')`;
  const apply = `select set_config('purge.apply', 'on', false);\n${SCRIPT}`;

  const prelaunch = await productionLike();
  await prelaunch.query(log, ["evt_test"]);
  await prelaunch.exec(apply);
  assert.equal(await count(prelaunch, `select count(*) n from payment_events`), 0);

  const launched = await productionLike();
  await launched.query(`insert into companies (legal_name, gstin, primary_contact_email) values ('Real Co Private Limited', '27AALCH4410D1ZW', 'ap@realco.in')`);
  await launched.query(log, ["evt_live"]);
  await launched.exec(apply);
  assert.equal(await count(launched, `select count(*) n from companies`), 1);
  assert.equal(await count(launched, `select count(*) n from payment_events`), 1);
});
