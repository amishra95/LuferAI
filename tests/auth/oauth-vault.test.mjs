// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// The OAuth token vault (lib/auth/oauth-vault.ts): AES-256-GCM encryption
// cycles, tamper and key checks, and storage in the in-memory store
// (oauth_credentials) holding only ciphertext.
import "../support/server-actions.mjs";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32);
process.env.OAUTH_VAULT_KEY = KEY.toString("base64");

const { decryptSecret, encryptSecret, readAllCredentials, readCredential, recordRefreshFailure, saveCredential, vaultKey, VaultError } = await import("../../lib/auth/oauth-vault.ts");
const { getOAuthCredentialRow } = await import("../../lib/data/index.ts");
const { mutateDb } = await import("../../lib/data/local-store.ts");

const aad = (s) => Buffer.from(s, "utf8");
const AAD = aad("oauth_credentials:zoho:access_token");

beforeEach(async () => {
  process.env.OAUTH_VAULT_KEY = KEY.toString("base64");
  await mutateDb((db) => void db.oauthCredentials.splice(0));
});

// ----------------------------------------------------------------------------
// The key
// ----------------------------------------------------------------------------

test("vaultKey: 32 bytes as base64 or hex; unset means no vault", () => {
  const env = (v) => (k) => (k === "OAUTH_VAULT_KEY" ? v : undefined);
  assert.deepEqual(vaultKey(env(KEY.toString("base64"))), KEY);
  assert.deepEqual(vaultKey(env(KEY.toString("hex"))), KEY);
  assert.deepEqual(vaultKey(env(`  ${KEY.toString("hex").toUpperCase()}\n`)), KEY);
  assert.equal(vaultKey(env(undefined)), null);
  assert.equal(vaultKey(env("   ")), null);
});

test("vaultKey: a key of the wrong size is an error, not a disabled vault", () => {
  const env = (v) => () => v;
  assert.throws(() => vaultKey(env(randomBytes(16).toString("base64"))), (e) => e instanceof VaultError && /32 bytes.*got 16/.test(e.message));
  assert.throws(() => vaultKey(env("not-a-key")), VaultError);
});

// ----------------------------------------------------------------------------
// Encryption cycles
// ----------------------------------------------------------------------------

test("encrypt → decrypt returns the token, for short, long and non-ASCII values", () => {
  for (const token of ["1000.abc", "x".repeat(4096), "tök€n✓", ""]) {
    const sealed = encryptSecret(token, KEY, AAD);
    assert.equal(decryptSecret(sealed, KEY, AAD), token);
  }
});

test("each encryption uses a fresh IV: the same token never seals to the same text", () => {
  const sealed = new Set(Array.from({ length: 50 }, () => encryptSecret("1000.same-token", KEY, AAD)));
  assert.equal(sealed.size, 50);
  for (const s of sealed) {
    const [version, iv, tag] = s.split(".");
    assert.equal(version, "v1");
    assert.equal(Buffer.from(iv, "base64url").length, 12);
    assert.equal(Buffer.from(tag, "base64url").length, 16);
    assert.ok(!s.includes("same-token"));
  }
});

test("altered ciphertext, tag or IV fails authentication", () => {
  const sealed = encryptSecret("1000.secret", KEY, AAD);
  const [v, iv, tag, ct] = sealed.split(".");
  const flip = (b64) => {
    const buf = Buffer.from(b64, "base64url");
    buf[0] ^= 0x01;
    return buf.toString("base64url");
  };
  for (const altered of [[v, iv, tag, flip(ct)], [v, iv, flip(tag), ct], [v, flip(iv), tag, ct]]) {
    assert.throws(() => decryptSecret(altered.join("."), KEY, AAD), (e) => e instanceof VaultError && /failed authentication/.test(e.message));
  }
});

test("another key can't decrypt it", () => {
  const sealed = encryptSecret("1000.secret", KEY, AAD);
  assert.throws(() => decryptSecret(sealed, randomBytes(32), AAD), VaultError);
});

test("bound to its provider and field: moved to another row or column, it won't decrypt", () => {
  const sealed = encryptSecret("1000.secret", KEY, AAD);
  assert.throws(() => decryptSecret(sealed, KEY, aad("oauth_credentials:erpnext:access_token")), VaultError);
  assert.throws(() => decryptSecret(sealed, KEY, aad("oauth_credentials:zoho:refresh_token")), VaultError);
});

test("rejects values that aren't vault ciphertexts", () => {
  for (const bad of ["plain-token", "v2.a.b.c", "v1.only.three", `v1.${Buffer.alloc(8).toString("base64url")}.${Buffer.alloc(16).toString("base64url")}.AA`]) {
    assert.throws(() => decryptSecret(bad, KEY, AAD), (e) => e instanceof VaultError && /Not a vault ciphertext/.test(e.message), bad);
  }
});

// ----------------------------------------------------------------------------
// Storage
// ----------------------------------------------------------------------------

const ZOHO = { provider: "zoho", accessToken: "1000.access-aaaa", refreshToken: "1000.refresh-bbbb", expiresAt: "2026-10-22T12:00:00.000Z", organizationId: "60001234" };

test("saveCredential stores only ciphertext; readCredential decrypts it", async () => {
  assert.equal(await saveCredential(ZOHO, null), true);

  const row = await getOAuthCredentialRow("zoho");
  const stored = JSON.stringify(row);
  assert.ok(!stored.includes("access-aaaa") && !stored.includes("refresh-bbbb"), stored);
  assert.match(row.encrypted_access_token, /^v1\./);
  assert.match(row.encrypted_refresh_token, /^v1\./);
  assert.deepEqual([row.expires_at, row.organization_id, row.version, row.last_error], [ZOHO.expiresAt, "60001234", 1, null]);

  const read = await readCredential("zoho");
  assert.deepEqual(
    { provider: read.provider, accessToken: read.accessToken, refreshToken: read.refreshToken, expiresAt: read.expiresAt, organizationId: read.organizationId, version: read.version },
    { ...ZOHO, version: 1 }
  );
  assert.equal(await readCredential("erpnext"), null);
});

test("a credential without a refresh token stores none", async () => {
  await saveCredential({ ...ZOHO, refreshToken: null }, null);
  assert.equal((await getOAuthCredentialRow("zoho")).encrypted_refresh_token, null);
  assert.equal((await readCredential("zoho")).refreshToken, null);
});

test("writes are compare-and-set on the version: a stale writer loses and changes nothing", async () => {
  assert.equal(await saveCredential(ZOHO, null), true);
  assert.equal(await saveCredential(ZOHO, null), false, "already exists");
  assert.equal(await saveCredential({ ...ZOHO, accessToken: "1000.second" }, 1), true);
  assert.equal(await saveCredential({ ...ZOHO, accessToken: "1000.stale" }, 1), false, "version moved on");
  const read = await readCredential("zoho");
  assert.deepEqual([read.accessToken, read.version], ["1000.second", 2]);
});

test("a refresh failure is noted without touching the tokens, and the next save clears it", async () => {
  await saveCredential(ZOHO, null);
  await recordRefreshFailure("zoho", "Refresh refused: invalid_code");
  let read = await readCredential("zoho");
  assert.deepEqual([read.lastError, read.accessToken, read.version], ["Refresh refused: invalid_code", ZOHO.accessToken, 1]);
  await saveCredential(ZOHO, 1);
  read = await readCredential("zoho");
  assert.equal(read.lastError, null);
});

test("a row copied between providers doesn't decrypt as the other provider's token", async () => {
  await saveCredential(ZOHO, null);
  await mutateDb((db) => {
    const zoho = db.oauthCredentials.find((c) => c.provider === "zoho");
    db.oauthCredentials.push({ ...zoho, provider: "erpnext" });
  });
  await assert.rejects(readCredential("erpnext"), VaultError);
});

test("with the key rotated away, stored tokens are unreadable", async () => {
  await saveCredential(ZOHO, null);
  process.env.OAUTH_VAULT_KEY = randomBytes(32).toString("hex");
  await assert.rejects(readAllCredentials(), VaultError);
  delete process.env.OAUTH_VAULT_KEY;
  await assert.rejects(readCredential("zoho"), (e) => e instanceof VaultError && /not set/.test(e.message));
});
