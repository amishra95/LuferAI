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

// --- event workspaces & RSVPs (migration 0022) -------------------------------------------

test("event guest lists: the company and admins read them; venues, strangers and anon see nothing", async () => {
  const booking = (await db.query(`select id from bookings where company_id = $1 order by event_date limit 1`, [NIMBUS])).rows[0].id;
  await db.query(`insert into event_workspaces (booking_id, tenant_id, title) values ($1, $2, 'Offsite dinner')`, [booking, NIMBUS]);
  await db.query(`insert into event_attendees (booking_id, tenant_id, name, email) values ($1, $2, 'Asha Rao', 'asha@nimbus.in'), ($1, $2, 'Dev Iyer', 'dev@nimbus.in')`, [booking, NIMBUS]);

  for (const tbl of ["event_attendees", "event_workspaces"]) {
    const total = await count(db, `select count(*) n from ${tbl}`);
    assert.equal(await as(U.client, (tx) => count(tx, `select count(*) n from ${tbl}`)), total, `client ${tbl}`);
    assert.equal(await as(U.admin, (tx) => count(tx, `select count(*) n from ${tbl}`)), total, `admin ${tbl}`);
    assert.equal(await as(U.property, (tx) => count(tx, `select count(*) n from ${tbl}`)), 0, `property ${tbl}`);
    assert.equal(await as(U.stranger, (tx) => count(tx, `select count(*) n from ${tbl}`)), 0, `stranger ${tbl}`);
    assert.equal(await asUser(db, { role: "anon" }, (tx) => count(tx, `select count(*) n from ${tbl}`)), 0, `anon ${tbl}`);
  }

  // Writes go through the app (service role); a client's own token can't write.
  await assert.rejects(
    as(U.client, (tx) => tx.query(`insert into event_attendees (booking_id, tenant_id, name, email) values ($1, $2, 'Eve', 'eve@x.in')`, [booking, NIMBUS])),
    /row-level security/
  );
  assert.equal(await as(U.client, async (tx) => (await tx.query(`update event_attendees set rsvp_status = 'ACCEPTED'`)).affectedRows), 0);
  assert.equal(await as(U.client, async (tx) => (await tx.query(`delete from event_attendees`)).affectedRows), 0);

  // A guest can't be filed under another company's booking.
  await assert.rejects(db.query(`insert into event_attendees (booking_id, tenant_id, name, email) values ($1, $2, 'Eve', 'eve@x.in')`, [booking, VERTEX]), /event_attendees_booking_fkey/);
});

test("event guest lists: replies are timestamped, tokens fixed, declines bring no one; schedule edits bump SEQUENCE", async () => {
  const booking = (await db.query(`select id from bookings where company_id = $1 order by event_date limit 1`, [NIMBUS])).rows[0].id;
  const { rows: [g] } = await db.query(`insert into event_attendees (booking_id, tenant_id, name, email, plus_ones) values ($1, $2, 'Meera Shah', 'meera@nimbus.in', 2) returning *`, [booking, NIMBUS]);
  assert.match(g.rsvp_token, /^[0-9a-f]{64}$/);
  assert.equal(g.responded_at, null);

  const { rows: [declined] } = await db.query(`update event_attendees set rsvp_status = 'DECLINED', rsvp_token = repeat('0', 64) where id = $1 returning *`, [g.id]);
  assert.equal(declined.rsvp_token, g.rsvp_token);
  assert.equal(declined.plus_ones, 0);
  assert.ok(declined.responded_at);
  const { rows: [reset] } = await db.query(`update event_attendees set rsvp_status = 'INVITED' where id = $1 returning responded_at`, [g.id]);
  assert.equal(reset.responded_at, null);

  await assert.rejects(db.query(`insert into event_attendees (booking_id, tenant_id, name, email) values ($1, $2, 'Bad', 'Bad;x@nimbus.in')`, [booking, NIMBUS]), /check/);
  await assert.rejects(db.query(`insert into event_attendees (booking_id, tenant_id, name, email) values ($1, $2, 'Twice', 'meera@nimbus.in')`, [booking, NIMBUS]), /duplicate key/);

  const seq = async () => (await db.query(`select ics_sequence from event_workspaces where booking_id = $1`, [booking])).rows[0].ics_sequence;
  const start = await seq();
  await db.query(`update event_workspaces set rsvp_deadline = current_date where booking_id = $1`, [booking]);
  assert.equal(await seq(), start, "the deadline isn't on the invite");
  await db.query(`update event_workspaces set starts_at = '20:00', ics_sequence = 0 where booking_id = $1`, [booking]);
  assert.equal(await seq(), start + 1);
});

test("event channels: Realtime authorises `event:<booking id>` to the booking's company and admins; tables are published", async () => {
  // A stand-in for the parts of Supabase Realtime migration 0022 hooks into.
  const rt = await createDatabase({
    prelude: `
      create schema realtime;
      create table realtime.messages (id uuid primary key default gen_random_uuid(), topic text not null, extension text not null, payload jsonb);
      alter table realtime.messages enable row level security;
      grant usage on schema realtime to authenticated;
      grant select, insert on realtime.messages to authenticated;
      create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
      grant execute on function realtime.topic() to authenticated;
      create publication supabase_realtime;`,
  });
  const nimbus = (await rt.query(`select id from bookings where company_id = $1 limit 1`, [NIMBUS])).rows[0].id;
  const vertex = (await rt.query(`select id from bookings where company_id = $1 limit 1`, [VERTEX])).rows[0].id;
  await rt.query(`insert into auth.users (id, email) values ($1, 'c@x.test'), ($2, 'a@x.test')`, [U.client, U.admin]);
  await rt.query(`insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $2, 'ORGANIZER'), ($3, 'ADMIN', null, null)`, [U.client, NIMBUS, U.admin]);

  const canJoin = (user, topic) =>
    asUser(rt, { claims: { sub: user } }, async (tx) => {
      await tx.query(`select set_config('realtime.topic', $1, true)`, [topic]);
      await tx.query(`insert into realtime.messages (topic, extension) values ($1, 'presence')`, [topic]);
      return true;
    }).catch((err) => (/row-level security/.test(err.message) ? false : Promise.reject(err)));

  assert.equal(await canJoin(U.client, `event:${nimbus}`), true);
  assert.equal(await canJoin(U.client, `event:${vertex}`), false);
  assert.equal(await canJoin(U.client, `event:${nimbus}x`), false);
  assert.equal(await canJoin(U.client, `booking:${nimbus}`), false);
  assert.equal(await canJoin(U.admin, `event:${vertex}`), true);
  assert.equal(await canJoin(U.stranger, `event:${nimbus}`), false);

  const published = (await rt.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map((r) => r.tablename);
  assert.deepEqual(published, ["event_attendees", "event_workspaces"]);
});

// --- marketplace settlement (migration 0023) ---------------------------------------------

test("marketplace: stock is reserved on order and returned on cancel; commission is snapshotted", async () => {
  const { rows: [p] } = await db.query(`insert into partners (name, slug, gstin, commission_rate) values ('Giftwise', 'giftwise-t', '29AAGCG4512K1ZG', 0.12) returning id`);
  const { rows: [item] } = await db.query(
    `insert into catalog_items (partner_id, category, ref, name, unit_price_inr, tax_kind, tax_code, gst_rate_percent, stock_quantity)
     values ($1, 'gifting', 'HAMPER', 'Hamper', 1000, 'HSN', '2106', 18, 10) returning id`,
    [p.id]
  );
  const order = (qty) =>
    db.query(
      `insert into catalog_orders (tenant_id, item_id, partner_id, category, quantity, unit_price_inr, total_amount_inr, invoice, needed_by, cost_center)
       values ($1, $2, $3, 'gifting', $4, 1000, $4 * 1000, '{}', current_date + 10, 'CC-1') returning id, commission_rate`,
      [NIMBUS, item.id, p.id, qty]
    );
  const stock = async () => (await db.query(`select stock_quantity from catalog_items where id = $1`, [item.id])).rows[0].stock_quantity;

  const { rows: [o] } = await order(7);
  assert.equal(Number(o.commission_rate), 0.12);
  assert.equal(await stock(), 3);
  await assert.rejects(order(4), (err) => err.code === "23514" && /Only 3 left/.test(err.message));
  assert.equal(await stock(), 3);
  await db.query(`update partners set commission_rate = 0.2 where id = $1`, [p.id]);
  assert.equal(Number((await db.query(`select commission_rate from catalog_orders where id = $1`, [o.id])).rows[0].commission_rate), 0.12, "later rate changes don't rewrite orders");
  await db.query(`update catalog_orders set status = 'CANCELLED' where id = $1`, [o.id]);
  assert.equal(await stock(), 10);

  // Untracked stock never blocks an order.
  await db.query(`update catalog_items set stock_quantity = null where id = $1`, [item.id]);
  await order(500);
  assert.equal(await stock(), null);
});

test("marketplace: payments are for a booking or an order; payouts must add up; TCS signs and heads are enforced; partners and buyers see only their own", async () => {
  const { rows: [p] } = await db.query(`insert into partners (name, slug, gstin) values ('Threadline', 'threadline-t', '33AAKCT6620P1ZV') returning id`);
  const { rows: [other] } = await db.query(`insert into partners (name, slug) values ('Other', 'other-t') returning id`);
  const { rows: [item] } = await db.query(`insert into catalog_items (partner_id, category, ref, name, unit_price_inr, tax_kind, tax_code, gst_rate_percent) values ($1, 'merch', 'TEE', 'Tee', 650, 'HSN', '6109', 5) returning id`, [p.id]);
  const { rows: [o] } = await db.query(
    `insert into catalog_orders (tenant_id, item_id, partner_id, category, quantity, unit_price_inr, total_amount_inr, invoice, needed_by, cost_center)
     values ($1, $2, $3, 'merch', 10, 650, 6500, '{"invoice_total": 6825}', current_date + 14, 'CC-1') returning id`,
    [NIMBUS, item.id, p.id]
  );
  const booking = (await db.query(`select id from bookings where company_id = $1 limit 1`, [NIMBUS])).rows[0].id;
  const pay = (bookingId, orderId) =>
    db.query(`insert into payments (booking_id, catalog_order_id, provider, amount_inr, deposit_rate, provider_order_id, invoice) values ($1, $2, 'razorpay', 6825, 1, gen_random_uuid()::text, '{}') returning id`, [bookingId, orderId]);
  await assert.rejects(pay(booking, o.id), /payments_subject_check/);
  await assert.rejects(pay(null, null), /payments_subject_check/);
  const { rows: [payment] } = await pay(null, o.id);

  const payout = (net) =>
    db.query(
      `insert into vendor_payouts (catalog_order_id, partner_id, payment_id, linked_account_id, gross_inr, taxable_inr, commission_rate, commission_inr, commission_gst_inr, tcs_rate_bps, tcs_inr, net_payout_inr)
       values ($1, $2, $3, 'acc_AAAAAAAAAAAAAA', 6825, 6500, 0.08, 520, 93.6, 50, 32.5, $4)`,
      [o.id, p.id, payment.id, net]
    );
  await assert.rejects(payout(6200), /vendor_payouts_net_check/);
  await payout(6178.9);

  const tcs = (kind, taxable, cgst, igst) =>
    db.query(
      `insert into tcs_entries (catalog_order_id, partner_id, supplier_gstin, place_of_supply, return_period, kind, taxable_inr, rate_bps, cgst_inr, sgst_inr, igst_inr)
       values ($1, $2, '33AAKCT6620P1ZV', '29', '2026-10', $3, $4, 50, $5, $5, $6)`,
      [o.id, p.id, kind, taxable, cgst, igst]
    );
  await assert.rejects(tcs("collection", 6500, 16.25, 32.5), /tcs_entries_heads_check/);
  await assert.rejects(tcs("reversal", 6500, 0, 32.5), /tcs_entries_sign_check/);
  await tcs("collection", 6500, 0, 32.5);
  await tcs("reversal", -6500, 0, -32.5);
  const { rows: [g] } = await db.query(`select * from tcs_gstr8_summary where supplier_gstin = '33AAKCT6620P1ZV'`);
  assert.deepEqual([g.gross_supplies_inr, g.supplies_returned_inr, g.net_taxable_inr, g.igst_inr].map(Number), [6500, 6500, 0, 0]);

  // Visibility: the supplier and the buyer, nobody else.
  const partnerUser = "a0000000-0000-4000-8000-000000000006";
  const otherUser = "a0000000-0000-4000-8000-000000000007";
  await db.query(`insert into auth.users (id, email) values ($1, 'p@x.test'), ($2, 'o@x.test')`, [partnerUser, otherUser]);
  await db.query(`insert into platform_users (user_id, role, partner_id, partner_role) values ($1, 'PARTNER', $2, 'OWNER'), ($3, 'PARTNER', $4, 'OWNER')`, [partnerUser, p.id, otherUser, other.id]);
  for (const tbl of ["vendor_payouts", "tcs_entries"]) {
    assert.equal(await as(partnerUser, (tx) => count(tx, `select count(*) n from ${tbl} where catalog_order_id = $1`, [o.id])), tbl === "tcs_entries" ? 2 : 1, `partner ${tbl}`);
    assert.equal(await as(otherUser, (tx) => count(tx, `select count(*) n from ${tbl}`)), 0, `other partner ${tbl}`);
    assert.equal(await as(U.client, (tx) => count(tx, `select count(*) n from ${tbl}`)), 0, `buyer ${tbl}`);
  }
  assert.equal(await as(U.client, (tx) => count(tx, `select count(*) n from payments where id = $1`, [payment.id])), 1, "buyer sees their order payment");
  assert.equal(await as(partnerUser, (tx) => count(tx, `select count(*) n from payments where id = $1`, [payment.id])), 1, "supplier sees it");
  assert.equal(await as(otherUser, (tx) => count(tx, `select count(*) n from payments where id = $1`, [payment.id])), 0);
  assert.equal(await as(U.property, (tx) => count(tx, `select count(*) n from payments where id = $1`, [payment.id])), 0);
});
