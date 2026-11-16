import { clean, isAuthConfigured } from "./env.ts";

export interface SignInProviders {
  /** Google OAuth is enabled in Supabase Auth. */
  google: boolean;
  /** SAML single sign-on is enabled (Supabase Pro). */
  sso: boolean;
}

const NONE: SignInProviders = { google: false, sso: false };

/**
 * Which extra sign-in methods Supabase Auth has switched on, read from the
 * project's public /auth/v1/settings. When Google is off, Supabase answers the
 * OAuth redirect with a bare JSON error, so the login page hides those buttons.
 * Fails closed (nothing extra) on any error or after 2s; cached for 5 minutes.
 */
export async function signInProviders(fetchImpl: typeof fetch = fetch): Promise<SignInProviders> {
  if (!isAuthConfigured()) return NONE;
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  try {
    const res = await fetchImpl(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(2000),
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return NONE;
    const settings = (await res.json()) as { external?: Record<string, unknown>; saml_enabled?: unknown };
    return { google: settings.external?.google === true, sso: settings.saml_enabled === true };
  } catch {
    return NONE;
  }
}
