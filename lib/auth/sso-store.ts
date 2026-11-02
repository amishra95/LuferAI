import "server-only";

import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CompanySsoConnection } from "@/lib/supabase/database.types";
import { decideSsoProvisioning, emailDomain, normaliseDomain, SSO_ROLES, type CorporateRole, type ProvisionDecision } from "@/lib/auth/sso";

/** An admin-facing reason an SSO change was refused. */
export class SsoError extends Error {}

/** Postgres "relation does not exist": before migration 20261108000000. */
const missingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export async function listSsoConnections(companyId: string): Promise<{ connections: CompanySsoConnection[]; ready: boolean }> {
  if (dataSource() !== "supabase") return { connections: [], ready: false };
  const { data, error } = await createAdminClient().from("company_sso_connections").select("*").eq("company_id", companyId).order("domain");
  if (missingTable(error)) return { connections: [], ready: false };
  if (error) throw error;
  return { connections: data, ready: true };
}

export async function addSsoConnection(input: { companyId: string; domain: string; providerId: string; defaultRole: string }): Promise<void> {
  const domain = normaliseDomain(input.domain);
  if (!domain) throw new SsoError("Enter the email domain, e.g. acme.com.");
  const providerId = input.providerId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(providerId)) throw new SsoError("Enter the SSO provider id from `supabase sso list` (a UUID).");
  if (!SSO_ROLES.includes(input.defaultRole as CorporateRole)) throw new SsoError("Choose a default role.");
  const { error } = await createAdminClient()
    .from("company_sso_connections")
    .insert({ company_id: input.companyId, domain, sso_provider_id: providerId, default_role: input.defaultRole as CorporateRole });
  if (error?.code === "23505") throw new SsoError(`${domain} is already connected to a company.`);
  if (missingTable(error)) throw new SsoError("SSO needs database migration 20261108000000.");
  if (error) throw error;
}

export async function setSsoConnectionEnabled(companyId: string, id: string, enabled: boolean): Promise<void> {
  const { error } = await createAdminClient().from("company_sso_connections").update({ enabled }).eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}

export async function removeSsoConnection(companyId: string, id: string): Promise<void> {
  const { error } = await createAdminClient().from("company_sso_connections").delete().eq("id", id).eq("company_id", companyId);
  if (error) throw error;
}

/**
 * First SSO sign-in: gives a user without a membership one in the company
 * their domain's provider is connected to (lib/auth/sso.ts decides). Returns
 * the decision; never throws, so a failure just leaves them without access.
 */
export async function provisionSsoUser(user: { id: string; email?: string | null; app_metadata?: object | null }): Promise<ProvisionDecision> {
  try {
    const domain = emailDomain(user.email);
    if (!domain) return { provision: false, reason: "no_email" };
    const db = createAdminClient();
    const { data: connection, error } = await db.from("company_sso_connections").select("*").eq("domain", domain).maybeSingle();
    if (error && !missingTable(error)) throw error;
    const decision = decideSsoProvisioning(user, connection ?? null);
    if (!decision.provision) return decision;
    const { error: insertError } = await db
      .from("platform_users")
      .insert({ user_id: user.id, role: "CLIENT", company_id: decision.companyId, corporate_role: decision.corporateRole });
    // Already a member (a concurrent callback): fine.
    if (insertError && insertError.code !== "23505") throw insertError;
    return decision;
  } catch (err) {
    console.error("auth: SSO provisioning failed", err);
    return { provision: false, reason: "no_connection" };
  }
}
