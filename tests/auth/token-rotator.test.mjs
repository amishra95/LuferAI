// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// The OAuth token rotator (lib/auth/token-rotator.ts) against the real vault
// and in-memory store, with the providers' token endpoints faked: which tokens
// get refreshed, the Zoho and ERPNext grants, seeding from env, failures, and
// concurrent refreshes.
import "../support/server-actions.mjs";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.OAUTH_VAULT_KEY = randomBytes(32).toString("base64");

const { readCredential, saveCredential } = await import("../../lib/auth/oauth-vault.ts");
const { accessTokenFor, needsRefresh, OAuthRefreshError, REFRESH_WINDOW_MS, refreshClientFor, refreshProvider, requestTokenRefresh, rotateExpiringTokens } = await import("../../lib/auth/token-rotator.ts");
const { mutateDb } = await import("../../lib/data/local-store.ts");

const NOW = Date.parse("2026-10-22T10:00:00.000Z");
const now = () => NOW;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const MIN = 60_000;

const ENV = {
  ZOHO_CLIENT_ID: "1000.CLIENT",
  ZOHO_CLIENT_SECRET: "zoho-client-secret",
  ZOHO_EXPENSE_ORGANIZATION_ID: "60001234",
  ERPNEXT_URL: "https://acme.erpnext.com/api/resource/Purchase Invoice",
  ERPNEXT_OAUTH_CLIENT_ID: "erp-client",
  ERPNEXT_OAUTH_CLIENT_SECRET: "erp-secret",
};
const envOf = (vars) => (k) => vars[k] ?? "";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fake token endpoint: records each request (URL + form fields) and answers with `reply(form, url)`. */
function tokenEndpoint(reply) {
  const calls = [];
  const fetch = async (url, init) => {
    const form = Object.fromEntries(new URLSearchParams(String(init.body)));
    calls.push({ url: String(url), method: init.method, contentType: init.headers["Content-Type"], form });
    return reply(form, String(url));
  };
  return { fetch, calls };
}

let auditLines = [];
beforeEach(async () => {
  await mutateDb((db) => void db.oauthCredentials.splice(0));
  auditLines = [];
  mock.method(console, "info", (line) => {
    try {
      const entry = JSON.parse(line);
      if (entry.audit === "oauth_refresh") auditLines.push(entry);
    } catch {}
  });
});
afterEach(() => mock.restoreAll());

const seed = (provider, fields) => saveCredential({ provider, accessToken: "old-access", refreshToken: "old-refresh", expiresAt: iso(60 * MIN), organizationId: null, ...fields }, null);

// ----------------------------------------------------------------------------
// When to refresh
// ----------------------------------------------------------------------------

test("needsRefresh: tokens expiring within 10 minutes (or already expired); never for tokens without expiry", () => {
  assert.equal(REFRESH_WINDOW_MS, 10 * MIN);
  assert.equal(needsRefresh({ expiresAt: iso(10 * MIN + 1) }, NOW), false);
  assert.equal(needsRefresh({ expiresAt: iso(10 * MIN) }, NOW), true);
  assert.equal(needsRefresh({ expiresAt: iso(30_000) }, NOW), true);
  assert.equal(needsRefresh({ expiresAt: iso(-MIN) }, NOW), true);
  assert.equal(needsRefresh({ expiresAt: null }, NOW), false);
});

// ----------------------------------------------------------------------------
// Provider clients
// ----------------------------------------------------------------------------

test("Zoho client: needs id and secret; the accounts server defaults to .com and follows the data centre", () => {
  assert.deepEqual(refreshClientFor("zoho", envOf(ENV)), { tokenUrl: "https://accounts.zoho.com/oauth/v2/token", clientId: "1000.CLIENT", clientSecret: "zoho-client-secret" });
  assert.equal(refreshClientFor("zoho", envOf({ ...ENV, ZOHO_ACCOUNTS_URL: "https://accounts.zoho.in/" })).tokenUrl, "https://accounts.zoho.in/oauth/v2/token");
  assert.equal(refreshClientFor("zoho", envOf({ ZOHO_CLIENT_ID: "1000.CLIENT" })), null);
});

test("ERPNext client: Frappe's get_token on the site's origin, or an explicit URL; none without an OAuth client", () => {
  assert.deepEqual(refreshClientFor("erpnext", envOf(ENV)), { tokenUrl: "https://acme.erpnext.com/api/method/frappe.integrations.oauth2.get_token", clientId: "erp-client", clientSecret: "erp-secret" });
  assert.equal(refreshClientFor("erpnext", envOf({ ...ENV, ERPNEXT_OAUTH_TOKEN_URL: "https://sso.acme.test/token" })).tokenUrl, "https://sso.acme.test/token");
  assert.equal(refreshClientFor("erpnext", envOf({ ...ENV, ERPNEXT_OAUTH_CLIENT_SECRET: "" })).clientSecret, null, "public client");
  assert.equal(refreshClientFor("erpnext", envOf({ ERPNEXT_URL: ENV.ERPNEXT_URL, ERPNEXT_API_KEY: "k", ERPNEXT_API_SECRET: "s" })), null, "API key auth: nothing to rotate");
  assert.equal(refreshClientFor("erpnext", envOf({ ERPNEXT_OAUTH_CLIENT_ID: "erp-client" })), null, "no site to derive the URL from");
});

test("requestTokenRefresh: a form-encoded refresh_token grant; expiry from expires_in", async () => {
  const { fetch, calls } = tokenEndpoint(() => json(200, { access_token: "1000.new", expires_in: 3600, token_type: "Bearer", api_domain: "https://www.zohoapis.com" }));
  const grant = await requestTokenRefresh("zoho", "1000.refresh", refreshClientFor("zoho", envOf(ENV)), { fetch, now });
  assert.deepEqual(grant, { accessToken: "1000.new", refreshToken: null, expiresAt: iso(3600_000) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].contentType, "application/x-www-form-urlencoded");
  assert.deepEqual(calls[0].form, { grant_type: "refresh_token", refresh_token: "1000.refresh", client_id: "1000.CLIENT", client_secret: "zoho-client-secret" });
});

test("requestTokenRefresh: refusals carry the provider's reason, including Zoho's 200-with-error", async () => {
  const client = refreshClientFor("zoho", envOf(ENV));
  for (const [res, reason] of [
    [json(200, { error: "invalid_code" }), /invalid_code/],
    [json(400, { error: "invalid_grant", error_description: "Refresh token expired" }), /invalid_grant: Refresh token expired/],
    [new Response("<html>bad gateway</html>", { status: 502 }), /HTTP 502/],
  ]) {
    await assert.rejects(requestTokenRefresh("zoho", "r", client, { fetch: async () => res, now }), (e) => e instanceof OAuthRefreshError && reason.test(e.message));
  }
  await assert.rejects(
    requestTokenRefresh("zoho", "r", client, { fetch: async () => Promise.reject(new TypeError("fetch failed")), now }),
    (e) => e instanceof OAuthRefreshError && /unreachable: fetch failed/.test(e.message)
  );
});

// ----------------------------------------------------------------------------
// The sweep
// ----------------------------------------------------------------------------

test("rotateExpiringTokens: leaves fresh tokens alone and makes no request", async () => {
  await seed("zoho", { expiresAt: iso(45 * MIN) });
  await seed("erpnext", { expiresAt: iso(11 * MIN) });
  const { fetch, calls } = tokenEndpoint(() => assert.fail("no refresh expected"));
  const results = await rotateExpiringTokens({ fetch, now, env: envOf(ENV) });
  assert.deepEqual(results, [
    { provider: "zoho", status: "fresh", expiresAt: iso(45 * MIN) },
    { provider: "erpnext", status: "fresh", expiresAt: iso(11 * MIN) },
  ]);
  assert.equal(calls.length, 0);
});

test("rotateExpiringTokens: Zoho expiring within 10 minutes is refreshed; its refresh token and organisation are kept", async () => {
  await seed("zoho", { expiresAt: iso(9 * MIN), organizationId: "60001234" });
  const { fetch, calls } = tokenEndpoint(() => json(200, { access_token: "1000.fresh", expires_in: 3600 }));
  const [zoho] = await rotateExpiringTokens({ fetch, now, env: envOf(ENV) });
  assert.deepEqual(zoho, { provider: "zoho", status: "refreshed", expiresAt: iso(60 * MIN) });
  assert.equal(calls[0].form.refresh_token, "old-refresh");

  const stored = await readCredential("zoho");
  assert.deepEqual([stored.accessToken, stored.refreshToken, stored.expiresAt, stored.organizationId, stored.version], ["1000.fresh", "old-refresh", iso(60 * MIN), "60001234", 2]);
});

test("rotateExpiringTokens: ERPNext's rotated refresh token replaces the old one", async () => {
  await seed("erpnext", { expiresAt: iso(2 * MIN) });
  const { fetch, calls } = tokenEndpoint(() => json(200, { access_token: "erp-fresh", refresh_token: "erp-refresh-2", expires_in: 3600, token_type: "Bearer" }));
  const results = await rotateExpiringTokens({ fetch, now, env: envOf(ENV) });
  assert.deepEqual(results.find((r) => r.provider === "erpnext"), { provider: "erpnext", status: "refreshed", expiresAt: iso(60 * MIN) });
  assert.equal(calls[0].url, "https://acme.erpnext.com/api/method/frappe.integrations.oauth2.get_token");
  assert.deepEqual(calls[0].form, { grant_type: "refresh_token", refresh_token: "old-refresh", client_id: "erp-client", client_secret: "erp-secret" });
  const stored = await readCredential("erpnext");
  assert.deepEqual([stored.accessToken, stored.refreshToken], ["erp-fresh", "erp-refresh-2"]);
});

test("rotateExpiringTokens: an empty vault is seeded from the env refresh token (with Zoho's organisation)", async () => {
  const { fetch, calls } = tokenEndpoint(() => json(200, { access_token: "1000.first", expires_in: 3600 }));
  const [zoho, erpnext] = await rotateExpiringTokens({ fetch, now, env: envOf({ ...ENV, ZOHO_REFRESH_TOKEN: "1000.seed" }) });
  assert.deepEqual(zoho, { provider: "zoho", status: "refreshed", expiresAt: iso(60 * MIN) });
  assert.deepEqual(erpnext, { provider: "erpnext", status: "unconfigured" }, "no ERPNext refresh token to seed from");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].form.refresh_token, "1000.seed");
  const stored = await readCredential("zoho");
  assert.deepEqual([stored.accessToken, stored.refreshToken, stored.organizationId, stored.version], ["1000.first", "1000.seed", "60001234", 1]);
  assert.equal(auditLines.find((l) => l.provider === "zoho").bootstrap, true);
});

test("rotateExpiringTokens: without an OAuth client or vault key, providers are unconfigured", async () => {
  await seed("zoho", { expiresAt: iso(MIN) });
  const { fetch, calls } = tokenEndpoint(() => assert.fail("no refresh expected"));
  assert.deepEqual(await rotateExpiringTokens({ fetch, now, env: envOf({}) }), [
    { provider: "zoho", status: "unconfigured" },
    { provider: "erpnext", status: "unconfigured" },
  ]);
  const key = process.env.OAUTH_VAULT_KEY;
  delete process.env.OAUTH_VAULT_KEY;
  try {
    assert.deepEqual((await rotateExpiringTokens({ fetch, now, env: envOf(ENV) })).map((r) => r.status), ["unconfigured", "unconfigured"]);
  } finally {
    process.env.OAUTH_VAULT_KEY = key;
  }
  assert.equal(calls.length, 0);
});

test("rotateExpiringTokens: a refused refresh keeps the old token, records the error, and never logs a token", async () => {
  await seed("zoho", { expiresAt: iso(5 * MIN) });
  const { fetch } = tokenEndpoint(() => json(200, { error: "invalid_code" }));
  const [zoho] = await rotateExpiringTokens({ fetch, now, env: envOf(ENV) });
  assert.deepEqual(zoho, { provider: "zoho", status: "failed", error: "Refresh refused: invalid_code" });
  const stored = await readCredential("zoho");
  assert.deepEqual([stored.accessToken, stored.version, stored.lastError], ["old-access", 1, "Refresh refused: invalid_code"]);
  const logged = JSON.stringify(auditLines);
  assert.match(logged, /"status":"failed"/);
  for (const secret of ["old-access", "old-refresh", "zoho-client-secret"]) assert.ok(!logged.includes(secret), secret);
});

// ----------------------------------------------------------------------------
// Concurrency
// ----------------------------------------------------------------------------

test("concurrent refreshes on one instance share a single request", async () => {
  await seed("zoho", { expiresAt: iso(MIN) });
  let release;
  const gate = new Promise((r) => (release = r));
  const { fetch, calls } = tokenEndpoint(async () => (await gate, json(200, { access_token: "1000.once", expires_in: 3600 })));
  const runs = [refreshProvider("zoho", { fetch, now, env: envOf(ENV) }), refreshProvider("zoho", { fetch, now, env: envOf(ENV) }), rotateExpiringTokens({ fetch, now, env: envOf(ENV) })];
  release();
  const [a, b, [c]] = await Promise.all(runs);
  assert.equal(calls.length, 1);
  assert.deepEqual([a.status, b.status, c.status], ["refreshed", "refreshed", "refreshed"]);
  assert.equal((await readCredential("zoho")).version, 2);
});

test("another instance refreshed first (Frappe refuses the spent refresh token): its fresh token is adopted", async () => {
  await seed("erpnext", { expiresAt: iso(MIN) });
  const { fetch } = tokenEndpoint(async () => {
    // Meanwhile, elsewhere: the other instance rotated the token pair.
    await saveCredential({ provider: "erpnext", accessToken: "erp-by-other", refreshToken: "erp-refresh-other", expiresAt: iso(60 * MIN), organizationId: null }, 1);
    return json(401, { error: "invalid_grant" });
  });
  const result = await refreshProvider("erpnext", { fetch, now, env: envOf(ENV) });
  assert.deepEqual(result, { provider: "erpnext", status: "fresh", expiresAt: iso(60 * MIN) });
  const stored = await readCredential("erpnext");
  assert.deepEqual([stored.accessToken, stored.refreshToken, stored.lastError], ["erp-by-other", "erp-refresh-other", null]);
  assert.equal(auditLines.at(-1).status, "adopted");
});

test("a refresh that loses the compare-and-set adopts the winner's token instead of overwriting it", async () => {
  await seed("zoho", { expiresAt: iso(MIN) });
  const { fetch } = tokenEndpoint(async () => {
    await saveCredential({ provider: "zoho", accessToken: "1000.winner", refreshToken: "old-refresh", expiresAt: iso(55 * MIN), organizationId: null }, 1);
    return json(200, { access_token: "1000.loser", expires_in: 3600 });
  });
  assert.deepEqual(await refreshProvider("zoho", { fetch, now, env: envOf(ENV) }), { provider: "zoho", status: "fresh", expiresAt: iso(55 * MIN) });
  assert.equal((await readCredential("zoho")).accessToken, "1000.winner");
});

// ----------------------------------------------------------------------------
// On use
// ----------------------------------------------------------------------------

test("accessTokenFor: refreshes a token about to expire before handing it out", async () => {
  await seed("zoho", { expiresAt: iso(3 * MIN), organizationId: "60001234" });
  const { fetch, calls } = tokenEndpoint(() => json(200, { access_token: "1000.just-in-time", expires_in: 3600 }));
  assert.deepEqual(await accessTokenFor("zoho", { fetch, now, env: envOf(ENV) }), { accessToken: "1000.just-in-time", organizationId: "60001234" });
  assert.equal(calls.length, 1);
});

test("accessTokenFor: a fresh token is returned as is", async () => {
  await seed("zoho", { accessToken: "1000.current", expiresAt: iso(50 * MIN) });
  const { fetch, calls } = tokenEndpoint(() => assert.fail("no refresh expected"));
  assert.deepEqual(await accessTokenFor("zoho", { fetch, now, env: envOf(ENV) }), { accessToken: "1000.current", organizationId: null });
  assert.equal(calls.length, 0);
});

test("accessTokenFor: if the refresh fails, a still-valid token is used until it actually expires; then nothing", async () => {
  const { fetch } = tokenEndpoint(() => json(503, {}));
  await seed("zoho", { accessToken: "1000.lapsing", expiresAt: iso(4 * MIN) });
  assert.deepEqual(await accessTokenFor("zoho", { fetch, now, env: envOf(ENV) }), { accessToken: "1000.lapsing", organizationId: null });

  await mutateDb((db) => void db.oauthCredentials.splice(0));
  await seed("zoho", { accessToken: "1000.expired", expiresAt: iso(-MIN) });
  assert.equal(await accessTokenFor("zoho", { fetch, now, env: envOf(ENV) }), null);
});

test("accessTokenFor: nothing for providers outside the vault, or with the vault off", async () => {
  const { fetch } = tokenEndpoint(() => assert.fail("no refresh expected"));
  assert.equal(await accessTokenFor("concur", { fetch, now, env: envOf(ENV) }), null);
  await seed("zoho", { expiresAt: iso(50 * MIN) });
  const key = process.env.OAUTH_VAULT_KEY;
  delete process.env.OAUTH_VAULT_KEY;
  try {
    assert.equal(await accessTokenFor("zoho", { fetch, now, env: envOf(ENV) }), null);
  } finally {
    process.env.OAUTH_VAULT_KEY = key;
  }
});
