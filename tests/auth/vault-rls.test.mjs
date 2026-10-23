// Run with: npm test
//
// Migrations 20261102000000 (oauth_credentials) and 20261102000100
// (tax_invoice_documents, dead-lettered exports) in Postgres (PGlite): only the
// service role reaches the vault, it refuses plaintext, and invoice documents
// follow tenant isolation.
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { asUser, createDatabase } from "../support/supabase-pglite.mjs";

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const U = {
  admin: "a1000000-0000-4000-8000-000000000001",
  client: "a1000000-0000-4000-8000-000000000002",
  property: "a1000000-0000-4000-8000-000000000003",
  stranger: "a1000000-0000-4000-8000-000000000004",
};
const SEALED = "v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb.cccc";
const SHA = "0".repeat(64);

let db;
let nimbusBooking;
let vertexBooking;

before(async () => {
  db = await createDatabase();
  nimbusBooking = (await db.query(`select id, venue_id from bookings where company_id = $1 limit 1`, [NIMBUS])).rows[0];
  vertexBooking = (await db.query(`select id, venue_id from bookings where company_id = $1 and venue_id <> $2 limit 1`, [VERTEX, nimbusBooking.venue_id])).rows[0];
  for (const [name, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`]);
  await db.query(
    `insert into platform_users (user_id, role, company_id, venue_id, corporate_role) values
       ($1, 'ADMIN', null, null, null), ($2, 'CLIENT', $4, null, 'APPROVER'), ($3, 'PROPERTY', null, $5, null)`,
    [U.admin, U.client, U.property, NIMBUS, nimbusBooking.venue_id]
  );
  await db.query(`insert into oauth_credentials (provider, encrypted_access_token, expires_at) values ('zoho', $1, now() + interval '1 hour')`, [SEALED]);
  await db.query(
    `insert into tax_invoice_documents (booking_id, tenant_id, status, html, html_sha256, rendered_at) values ($1, $2, 'rendered', '<html></html>', $5, now()), ($3, $4, 'rendered', '<html></html>', $5, now())`,
    [nimbusBooking.id, NIMBUS, vertexBooking.id, VERTEX, SHA]
  );
});

const as = (user, fn) => asUser(db, { claims: { sub: user } }, fn);
const anon = (fn) => asUser(db, { role: "anon" }, fn);

test("oauth_credentials: no API role can read or write it, admins included", async () => {
  for (const run of [(fn) => as(U.admin, fn), (fn) => as(U.client, fn), anon]) {
    await assert.rejects(run((tx) => tx.query(`select * from oauth_credentials`)), /permission denied/);
    await assert.rejects(run((tx) => tx.query(`update oauth_credentials set expires_at = now()`)), /permission denied/);
  }
});

test("oauth_credentials: the service role reads it", async () => {
  const rows = await asUser(db, { role: "service_role" }, async (tx) => (await tx.query(`select provider from oauth_credentials`)).rows);
  assert.deepEqual(rows, [{ provider: "zoho" }]);
});

test("oauth_credentials: refuses plaintext tokens and unknown providers", async () => {
  await assert.rejects(db.query(`insert into oauth_credentials (provider, encrypted_access_token) values ('erpnext', 'plain-token')`), /check constraint/);
  await assert.rejects(db.query(`insert into oauth_credentials (provider, encrypted_access_token, encrypted_refresh_token) values ('erpnext', $1, 'plain-refresh')`, [SEALED]), /check constraint/);
  await assert.rejects(db.query(`insert into oauth_credentials (provider, encrypted_access_token) values ('concur', $1)`, [SEALED]), /check constraint/);
});

test("oauth_credentials: updated_at moves on update", async () => {
  const before = (await db.query(`select updated_at from oauth_credentials where provider = 'zoho'`)).rows[0].updated_at;
  await db.query(`select pg_sleep(0.01)`);
  // now() is fixed within a transaction; PGlite runs each query in its own.
  const after = (await db.query(`update oauth_credentials set version = version + 1 where provider = 'zoho' returning updated_at`)).rows[0].updated_at;
  assert.ok(after > before);
});

test("tax_invoice_documents: the company and its venue see their own; admins all; strangers and anon nothing", async () => {
  const ids = async (run) => (await run(async (tx) => (await tx.query(`select booking_id from tax_invoice_documents order by booking_id`)).rows)).map((r) => r.booking_id);
  assert.deepEqual(await ids((fn) => as(U.client, fn)), [nimbusBooking.id]);
  assert.deepEqual(await ids((fn) => as(U.property, fn)), [nimbusBooking.id]);
  assert.deepEqual((await ids((fn) => as(U.admin, fn))).sort(), [nimbusBooking.id, vertexBooking.id].sort());
  assert.deepEqual(await ids((fn) => as(U.stranger, fn)), []);
  assert.deepEqual(await ids(anon), []);
});

test("tax_invoice_documents: users can't write them; a rendered row must carry its document", async () => {
  // No write policy: RLS matches no rows, even the company's own.
  const forged = await as(U.client, async (tx) => (await tx.query(`update tax_invoice_documents set html = 'forged' returning booking_id`)).rows);
  assert.deepEqual(forged, []);
  assert.equal((await db.query(`select html from tax_invoice_documents where booking_id = $1`, [nimbusBooking.id])).rows[0].html, "<html></html>");

  await assert.rejects(db.query(`update tax_invoice_documents set html = null where booking_id = $1`, [nimbusBooking.id]), /tax_invoice_documents_rendered_check/);
  await db.query(`update tax_invoice_documents set status = 'dead_lettered', html = null, html_sha256 = null, rendered_at = null, error = 'gave up' where booking_id = $1`, [vertexBooking.id]);
});

test("expense_exports: 'dead_lettered' is a valid status; anything else still isn't", async () => {
  const constraint = (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'expense_exports_status_check'`)).rows[0].d;
  for (const s of ["delivered", "mocked", "failed", "dead_lettered"]) assert.ok(constraint.includes(`'${s}'`), s);
  assert.ok(!constraint.includes("'queued'"));
});
