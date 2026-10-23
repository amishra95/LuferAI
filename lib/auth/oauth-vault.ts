import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getOAuthCredentialRow, listOAuthCredentialRows, recordOAuthCredentialError, saveOAuthCredentialRow } from "@/lib/data";
import type { OAuthCredentialRow } from "@/lib/supabase/database.types";

/**
 * The OAuth token vault: expense/ERP providers' access and refresh tokens,
 * stored in oauth_credentials (migration 20261102000000) encrypted with
 * AES-256-GCM under OAUTH_VAULT_KEY. The key stays in the app's environment, so
 * the database (and its backups) only ever hold ciphertext.
 *
 * Each sealed value is `v1.<iv>.<tag>.<ciphertext>` (base64url): a fresh
 * 96-bit IV per write, and the provider + field as associated data, so a
 * ciphertext copied into another row or column fails to decrypt instead of
 * being used as the wrong provider's token.
 *
 * lib/auth/token-rotator.ts keeps the tokens fresh.
 */

export const OAUTH_PROVIDERS = ["zoho", "erpnext"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const isOAuthProvider = (p: unknown): p is OAuthProvider => typeof p === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(p);

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * OAUTH_VAULT_KEY as a 32-byte key: 64 hex characters or base64 of 32 bytes
 * (`openssl rand -base64 32`). Null when unset; throws when set but malformed,
 * so a typo can't silently disable the vault.
 */
export function vaultKey(env: (name: string) => string | undefined = (k) => process.env[k]): Buffer | null {
  const raw = (env("OAUTH_VAULT_KEY") ?? "").trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) throw new VaultError(`OAUTH_VAULT_KEY must be 32 bytes (64 hex characters or base64); got ${key.length} bytes.`);
  return key;
}

function requireKey(): Buffer {
  const key = vaultKey();
  if (!key) throw new VaultError("OAUTH_VAULT_KEY is not set.");
  return key;
}

/** What a sealed value is bound to: decrypting it anywhere else fails. */
const aadFor = (provider: string, field: "access_token" | "refresh_token") => Buffer.from(`oauth_credentials:${provider}:${field}`, "utf8");

/** Encrypts `plaintext` with AES-256-GCM. `aad` is authenticated, not stored. */
export function encryptSecret(plaintext: string, key: Buffer, aad: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Decrypts a value from encryptSecret. Throws VaultError if it was altered, or sealed under another key or `aad`. */
export function decryptSecret(sealed: string, key: Buffer, aad: Buffer): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new VaultError("Not a vault ciphertext.");
  const [iv, tag, ciphertext] = parts.slice(1).map((p) => Buffer.from(p, "base64url"));
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new VaultError("Not a vault ciphertext.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("Vault ciphertext failed authentication (wrong key, or altered).");
  }
}

/** A provider's credential as the app uses it, decrypted. */
export interface OAuthCredential {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp; null if the token doesn't expire. */
  expiresAt: string | null;
  organizationId: string | null;
  /** For saveCredential: the version this was read at. */
  version: number;
  refreshedAt: string | null;
  lastError: string | null;
}

export type NewOAuthCredential = Pick<OAuthCredential, "provider" | "accessToken" | "refreshToken" | "expiresAt" | "organizationId">;

function open(row: OAuthCredentialRow, key: Buffer): OAuthCredential {
  if (!isOAuthProvider(row.provider)) throw new VaultError(`Unknown OAuth provider ${row.provider}.`);
  return {
    provider: row.provider,
    accessToken: decryptSecret(row.encrypted_access_token, key, aadFor(row.provider, "access_token")),
    refreshToken: row.encrypted_refresh_token ? decryptSecret(row.encrypted_refresh_token, key, aadFor(row.provider, "refresh_token")) : null,
    expiresAt: row.expires_at,
    organizationId: row.organization_id,
    version: row.version,
    refreshedAt: row.refreshed_at,
    lastError: row.last_error,
  };
}

/** A provider's stored credential, decrypted; null if there is none. */
export async function readCredential(provider: OAuthProvider): Promise<OAuthCredential | null> {
  const row = await getOAuthCredentialRow(provider);
  return row ? open(row, requireKey()) : null;
}

/** Every stored credential, decrypted. */
export async function readAllCredentials(): Promise<OAuthCredential[]> {
  const rows = await listOAuthCredentialRows();
  if (!rows.length) return [];
  const key = requireKey();
  return rows.map((r) => open(r, key));
}

/**
 * Encrypts and stores a credential if the stored one is still at
 * `expectedVersion` (null: none stored yet). Returns false if another writer
 * changed it first; re-read and decide again.
 */
export async function saveCredential(credential: NewOAuthCredential, expectedVersion: number | null): Promise<boolean> {
  const key = requireKey();
  const { provider } = credential;
  return saveOAuthCredentialRow(
    {
      provider,
      encrypted_access_token: encryptSecret(credential.accessToken, key, aadFor(provider, "access_token")),
      encrypted_refresh_token: credential.refreshToken ? encryptSecret(credential.refreshToken, key, aadFor(provider, "refresh_token")) : null,
      expires_at: credential.expiresAt,
      organization_id: credential.organizationId,
      refreshed_at: new Date().toISOString(),
    },
    expectedVersion
  );
}

/** Notes a failed refresh on the credential (shown to operators; never a token). */
export async function recordRefreshFailure(provider: OAuthProvider, message: string): Promise<void> {
  await recordOAuthCredentialError(provider, message);
}
