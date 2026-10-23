import "server-only";

import { isOAuthProvider, OAUTH_PROVIDERS, readCredential, recordRefreshFailure, saveCredential, vaultKey, type OAuthCredential, type OAuthProvider } from "@/lib/auth/oauth-vault";

/**
 * Keeps the vault's OAuth access tokens fresh (lib/auth/oauth-vault.ts):
 * tokens expiring within REFRESH_WINDOW_MS are exchanged for new ones with the
 * provider's refresh_token grant.
 *
 *   zoho     POST {ZOHO_ACCOUNTS_URL}/oauth/v2/token (accounts.zoho.com by
 *            default; .in / .eu etc. per data centre) with ZOHO_CLIENT_ID /
 *            ZOHO_CLIENT_SECRET. Zoho access tokens last an hour; the refresh
 *            token doesn't change.
 *   erpnext  Frappe's OAuth2 provider, POST {site}/api/method/
 *            frappe.integrations.oauth2.get_token (or ERPNEXT_OAUTH_TOKEN_URL)
 *            with ERPNEXT_OAUTH_CLIENT_ID (+ _SECRET for confidential clients).
 *            Frappe rotates the refresh token on every use. Without an OAuth
 *            client, ERPNext keeps its non-expiring API key/secret and there is
 *            nothing to rotate.
 *
 * The first credential comes from ZOHO_REFRESH_TOKEN / ERPNEXT_OAUTH_REFRESH_TOKEN:
 * when the vault has none, the rotator redeems it and stores the result.
 *
 * Runs every 5 minutes (/api/cron/rotate-oauth-tokens) and on use
 * (accessTokenFor, before each export), so an export never goes out with a
 * token about to lapse even if the cron is late. Concurrent refreshes are safe:
 * writes are compare-and-set on the credential's version, and a refresh that
 * loses (Frappe refuses an already-rotated refresh token) adopts the winner's.
 */

export const REFRESH_WINDOW_MS = 10 * 60_000;

type Env = (name: string) => string;

export interface RotatorOptions {
  now?: () => number;
  fetch?: typeof fetch;
  env?: Env;
}

const defaults = (opts: RotatorOptions) => ({
  now: opts.now ?? Date.now,
  fetch: opts.fetch ?? fetch,
  env: opts.env ?? ((k: string) => (process.env[k] ?? "").trim()),
});

export class OAuthRefreshError extends Error {
  constructor(
    readonly provider: OAuthProvider,
    message: string
  ) {
    super(message);
    this.name = "OAuthRefreshError";
  }
}

export interface RefreshClient {
  tokenUrl: string;
  clientId: string;
  clientSecret: string | null;
}

/** The provider's OAuth client from env, or null if refreshing isn't configured. */
export function refreshClientFor(provider: OAuthProvider, env: Env): RefreshClient | null {
  if (provider === "zoho") {
    const [clientId, clientSecret] = [env("ZOHO_CLIENT_ID"), env("ZOHO_CLIENT_SECRET")];
    if (!clientId || !clientSecret) return null;
    const accounts = (env("ZOHO_ACCOUNTS_URL") || "https://accounts.zoho.com").replace(/\/+$/, "");
    return { tokenUrl: `${accounts}/oauth/v2/token`, clientId, clientSecret };
  }
  const clientId = env("ERPNEXT_OAUTH_CLIENT_ID");
  if (!clientId) return null;
  let tokenUrl = env("ERPNEXT_OAUTH_TOKEN_URL");
  if (!tokenUrl) {
    const site = env("ERPNEXT_URL") || env("ERPNEXT_EXPENSE_URL");
    try {
      tokenUrl = `${new URL(site.replace(/ /g, "%20")).origin}/api/method/frappe.integrations.oauth2.get_token`;
    } catch {
      return null;
    }
  }
  return { tokenUrl, clientId, clientSecret: env("ERPNEXT_OAUTH_CLIENT_SECRET") || null };
}

const BOOTSTRAP_ENV: Record<OAuthProvider, string> = { zoho: "ZOHO_REFRESH_TOKEN", erpnext: "ERPNEXT_OAUTH_REFRESH_TOKEN" };
const ORGANIZATION_ENV: Partial<Record<OAuthProvider, string>> = { zoho: "ZOHO_EXPENSE_ORGANIZATION_ID" };

/** True when the token expires within `windowMs` of `now` (never, if it has no expiry). */
export function needsRefresh(credential: Pick<OAuthCredential, "expiresAt">, now: number, windowMs = REFRESH_WINDOW_MS): boolean {
  if (!credential.expiresAt) return false;
  return Date.parse(credential.expiresAt) - now <= windowMs;
}

export interface TokenGrant {
  accessToken: string;
  /** Only when the provider rotated it (Frappe); otherwise keep the old one. */
  refreshToken: string | null;
  expiresAt: string | null;
}

/** One refresh_token grant. Throws OAuthRefreshError with the provider's reason (never a token). */
export async function requestTokenRefresh(provider: OAuthProvider, refreshToken: string, client: RefreshClient, opts: RotatorOptions = {}): Promise<TokenGrant> {
  const { fetch: fetchFn, now } = defaults(opts);
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: client.clientId });
  if (client.clientSecret) body.set("client_secret", client.clientSecret);
  let res: Response;
  try {
    res = await fetchFn(client.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new OAuthRefreshError(provider, `Token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Zoho reports some failures as 200 with {"error": "invalid_code"}.
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!res.ok || !accessToken) {
    const reason = [json.error, json.error_description].filter((v) => typeof v === "string" && v).join(": ") || `HTTP ${res.status}`;
    throw new OAuthRefreshError(provider, `Refresh refused: ${reason}`);
  }
  const expiresIn = Number(json.expires_in);
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now() + expiresIn * 1000).toISOString() : null,
  };
}

/** One JSON line per refresh, for log pipelines. Never includes a token. */
function audit(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ audit: "oauth_refresh", at: new Date().toISOString(), ...entry }));
}

export type RotationResult =
  | { provider: OAuthProvider; status: "refreshed"; expiresAt: string | null }
  | { provider: OAuthProvider; status: "fresh"; expiresAt: string | null }
  | { provider: OAuthProvider; status: "unconfigured" }
  | { provider: OAuthProvider; status: "failed"; error: string };

/** In-process single flight: one refresh per provider at a time on this instance. */
const inFlight = new Map<OAuthProvider, Promise<RotationResult>>();

/**
 * Refreshes one provider's token if it expires within the window (or `force`),
 * seeding the vault from env when it has none. Never throws.
 */
export function refreshProvider(provider: OAuthProvider, opts: RotatorOptions & { force?: boolean } = {}): Promise<RotationResult> {
  const running = inFlight.get(provider);
  if (running) return running;
  const run = refreshOnce(provider, opts).finally(() => inFlight.delete(provider));
  inFlight.set(provider, run);
  return run;
}

async function refreshOnce(provider: OAuthProvider, opts: RotatorOptions & { force?: boolean }): Promise<RotationResult> {
  const { now, env } = defaults(opts);
  const client = refreshClientFor(provider, env);
  let current: OAuthCredential | null = null;
  try {
    if (!client || !vaultKey()) return { provider, status: "unconfigured" };
    current = await readCredential(provider);
    if (current && !opts.force && !needsRefresh(current, now())) return { provider, status: "fresh", expiresAt: current.expiresAt };

    const refreshToken = current?.refreshToken ?? env(BOOTSTRAP_ENV[provider]);
    if (!refreshToken) return current ? fail(provider, "No refresh token stored; re-authorise the app.", true) : { provider, status: "unconfigured" };

    const grant = await requestTokenRefresh(provider, refreshToken, client, opts);
    const saved = await saveCredential(
      {
        provider,
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken ?? refreshToken,
        expiresAt: grant.expiresAt,
        organizationId: current?.organizationId ?? (ORGANIZATION_ENV[provider] ? env(ORGANIZATION_ENV[provider]) || null : null),
      },
      current?.version ?? null
    );
    if (!saved) return adoptConcurrent(provider, current, now(), "lost a concurrent refresh");
    audit({ provider, status: "refreshed", expires_at: grant.expiresAt, bootstrap: !current });
    return { provider, status: "refreshed", expiresAt: grant.expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Another instance may have refreshed (and rotated the refresh token) meanwhile.
    if (current) {
      const adopted = await adoptConcurrent(provider, current, now(), message).catch(() => null);
      if (adopted?.status === "fresh") return adopted;
    }
    return fail(provider, message, Boolean(current));
  }
}

/** After a lost race: use the other writer's token if it is fresh, else report `reason`. */
async function adoptConcurrent(provider: OAuthProvider, before: OAuthCredential | null, now: number, reason: string): Promise<RotationResult> {
  const latest = await readCredential(provider);
  if (latest && latest.version !== before?.version && !needsRefresh(latest, now)) {
    audit({ provider, status: "adopted", expires_at: latest.expiresAt, reason });
    return { provider, status: "fresh", expiresAt: latest.expiresAt };
  }
  return fail(provider, reason, Boolean(latest));
}

async function fail(provider: OAuthProvider, error: string, stored: boolean): Promise<RotationResult> {
  audit({ provider, status: "failed", error });
  if (stored) await recordRefreshFailure(provider, error).catch(() => {});
  return { provider, status: "failed", error };
}

/** The background sweep: refreshes every provider whose token expires within 10 minutes. Never throws. */
export async function rotateExpiringTokens(opts: RotatorOptions = {}): Promise<RotationResult[]> {
  return Promise.all(OAUTH_PROVIDERS.map((p) => refreshProvider(p, opts)));
}

/**
 * The access token to call `provider` with, from the vault, refreshed first if
 * it is about to expire. Null when the vault has nothing usable for it (unset,
 * or expired and refresh failed): callers fall back to the env token.
 */
export async function accessTokenFor(provider: string, opts: RotatorOptions = {}): Promise<{ accessToken: string; organizationId: string | null } | null> {
  if (!isOAuthProvider(provider)) return null;
  const { now } = defaults(opts);
  try {
    if (!vaultKey()) return null;
    let credential = await readCredential(provider);
    if (!credential || needsRefresh(credential, now())) {
      await refreshProvider(provider, opts);
      credential = await readCredential(provider);
    }
    if (!credential) return null;
    // Refresh failed: a token inside the window is still valid until it actually expires.
    if (credential.expiresAt && Date.parse(credential.expiresAt) <= now()) return null;
    return { accessToken: credential.accessToken, organizationId: credential.organizationId };
  } catch (err) {
    console.error(`oauth vault: couldn't read the ${provider} token`, err instanceof Error ? err.message : err);
    return null;
  }
}
