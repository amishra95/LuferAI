/**
 * Enterprise SSO rules (migration 20261108000000): which email domain a
 * sign-in belongs to, and whether a first SSO sign-in may be given a
 * membership in a company. Pure: tests import it directly (tests/auth/sso.test.mjs).
 */

export type CorporateRole = "ORGANIZER" | "APPROVER" | "FINANCE_VIEWER";
export const SSO_ROLES: readonly CorporateRole[] = ["ORGANIZER", "APPROVER", "FINANCE_VIEWER"];

export interface SsoConnection {
  company_id: string;
  domain: string;
  sso_provider_id: string;
  default_role: CorporateRole;
  enabled: boolean;
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** "Asha@Acme.co.in" → "acme.co.in"; null for anything that isn't an address. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return null;
  const domain = (email ?? "").trim().toLowerCase().slice(at + 1);
  return normaliseDomain(domain);
}

/** A bare domain as stored: lowercase, no scheme, "@" or trailing dot; null if invalid. */
export function normaliseDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return d.length <= 253 && DOMAIN.test(d) ? d : null;
}

/** The Supabase SSO provider a session came from ("sso:<uuid>"), or null for any other sign-in. */
export function ssoProviderOf(appMetadata: object | null | undefined): string | null {
  const provider = (appMetadata as { provider?: unknown } | null | undefined)?.provider;
  if (typeof provider !== "string" || !provider.startsWith("sso:")) return null;
  const id = provider.slice(4);
  return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
}

export type ProvisionDecision =
  | { provision: true; companyId: string; corporateRole: CorporateRole }
  | { provision: false; reason: "not_sso" | "no_email" | "no_connection" | "disabled" | "provider_mismatch" };

/**
 * Whether someone signing in without a membership gets one. Only when the
 * session came through SSO, from the provider registered for their email's
 * domain, on an enabled connection: a provider set up for one company can't
 * mint members of another by asserting an address on its domain.
 */
export function decideSsoProvisioning(
  user: { email?: string | null; app_metadata?: object | null },
  connection: SsoConnection | null
): ProvisionDecision {
  const provider = ssoProviderOf(user.app_metadata);
  if (!provider) return { provision: false, reason: "not_sso" };
  const domain = emailDomain(user.email);
  if (!domain) return { provision: false, reason: "no_email" };
  if (!connection || connection.domain !== domain) return { provision: false, reason: "no_connection" };
  if (!connection.enabled) return { provision: false, reason: "disabled" };
  if (connection.sso_provider_id.toLowerCase() !== provider) return { provision: false, reason: "provider_mismatch" };
  return { provision: true, companyId: connection.company_id, corporateRole: connection.default_role };
}
