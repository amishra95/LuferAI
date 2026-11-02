// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Enterprise SSO with just-in-time provisioning:
//   1. the rules (lib/auth/sso.ts): domains, which provider a session came
//      from, and when a first SSO sign-in may join a company
//   2. migration 20261108000000 on PGlite: domain format, one company per
//      domain, and who can read connections
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { decideSsoProvisioning, emailDomain, normaliseDomain, ssoProviderOf } from "../../lib/auth/sso.ts";
import { asUser, createDatabase } from "../support/supabase-pglite.mjs";

const PROVIDER = "5d1b2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const OTHER_PROVIDER = "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e";
const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const connection = (over = {}) => ({ company_id: NIMBUS, domain: "nimbus.example", sso_provider_id: PROVIDER, default_role: "ORGANIZER", enabled: true, ...over });
const ssoUser = (email, provider = PROVIDER) => ({ email, app_metadata: { provider: `sso:${provider}`, providers: [`sso:${provider}`] } });

test("emailDomain and normaliseDomain accept real domains only", () => {
  assert.equal(emailDomain("Asha@Nimbus.Example"), "nimbus.example");
  assert.equal(emailDomain("a@b@corp.co.in"), "corp.co.in");
  assert.equal(emailDomain("no-at-sign"), null);
  assert.equal(emailDomain("@nimbus.example"), null);
  assert.equal(emailDomain("a@localhost"), null);
  assert.equal(normaliseDomain(" @Acme.com. "), "acme.com");
  assert.equal(normaliseDomain("https://acme.com"), null);
  assert.equal(normaliseDomain("-acme.com"), null);
});

test("ssoProviderOf reads only Supabase SSO sessions", () => {
  assert.equal(ssoProviderOf({ provider: `sso:${PROVIDER.toUpperCase()}` }), PROVIDER);
  assert.equal(ssoProviderOf({ provider: "email" }), null);
  assert.equal(ssoProviderOf({ provider: "google" }), null);
  assert.equal(ssoProviderOf({ provider: "sso:not-a-uuid" }), null);
  assert.equal(ssoProviderOf(undefined), null);
});

test("a first SSO sign-in from the domain's own provider joins the company", () => {
  assert.deepEqual(decideSsoProvisioning(ssoUser("asha@nimbus.example"), connection({ default_role: "FINANCE_VIEWER" })), {
    provision: true,
    companyId: NIMBUS,
    corporateRole: "FINANCE_VIEWER",
  });
});

test("everything else is refused", () => {
  const reason = (user, conn) => decideSsoProvisioning(user, conn).reason;
  // Email link, Google, or a forged-looking metadata value: not SSO.
  assert.equal(reason({ email: "asha@nimbus.example", app_metadata: { provider: "email" } }, connection()), "not_sso");
  // Another company's provider asserting an address on this domain.
  assert.equal(reason(ssoUser("asha@nimbus.example", OTHER_PROVIDER), connection()), "provider_mismatch");
  // The right provider, but an address on a domain this connection isn't for.
  assert.equal(reason(ssoUser("asha@vertex.example"), connection()), "no_connection");
  assert.equal(reason(ssoUser("asha@nimbus.example"), null), "no_connection");
  assert.equal(reason(ssoUser("asha@nimbus.example"), connection({ enabled: false })), "disabled");
  assert.equal(reason(ssoUser(null), connection()), "no_email");
});

// ----------------------------------------------------------------------------
// Database
// ----------------------------------------------------------------------------

const ALICE = "c0000000-0000-4000-8000-000000000001"; // Nimbus
const VICTOR = "c0000000-0000-4000-8000-000000000002"; // Vertex
let db;

before(async () => {
  db = await createDatabase();
  await db.query(`insert into auth.users (id, email) values ($1, 'alice@example.test'), ($2, 'victor@example.test')`, [ALICE, VICTOR]);
  await db.query(
    `insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $3, 'FINANCE_VIEWER'), ($2, 'CLIENT', $4, 'APPROVER')`,
    [ALICE, VICTOR, NIMBUS, VERTEX]
  );
});

test("migration: lowercase domains, one company each", async () => {
  await db.query(`insert into company_sso_connections (company_id, domain, sso_provider_id) values ($1, 'nimbus.example', $2)`, [NIMBUS, PROVIDER]);
  const { rows } = await db.query(`select default_role, enabled from company_sso_connections where domain = 'nimbus.example'`);
  assert.deepEqual(rows[0], { default_role: "ORGANIZER", enabled: true });
  await assert.rejects(db.query(`insert into company_sso_connections (company_id, domain, sso_provider_id) values ($1, 'nimbus.example', $2)`, [VERTEX, OTHER_PROVIDER]), /duplicate key/);
  for (const bad of ["Nimbus.example", "nimbus", "https://x.com", "@x.com"]) {
    await assert.rejects(db.query(`insert into company_sso_connections (company_id, domain, sso_provider_id) values ($1, $2, $3)`, [VERTEX, bad, OTHER_PROVIDER]), /check constraint/, bad);
  }
});

test("RLS: a company reads its own connections; nobody writes through the API", async () => {
  const count = (tx) => tx.query(`select count(*) n from company_sso_connections`).then((r) => Number(r.rows[0].n));
  assert.equal(await asUser(db, { claims: { sub: ALICE } }, count), 1);
  assert.equal(await asUser(db, { claims: { sub: VICTOR } }, count), 0);
  await assert.rejects(
    asUser(db, { claims: { sub: VICTOR } }, (tx) => tx.query(`insert into company_sso_connections (company_id, domain, sso_provider_id) values ($1, 'evil.example', $2)`, [NIMBUS, OTHER_PROVIDER])),
    /permission denied/
  );
});
