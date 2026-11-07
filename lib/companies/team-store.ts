import "server-only";

import type { User } from "@supabase/supabase-js";

import { dataSource } from "@/lib/data";
import { notifyTeamInvite } from "@/lib/services/notifications";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHierarchy, saveHierarchy } from "@/lib/services/enterprise/governanceStore";
import { inviteMessage, removalRefusal, type TeamInvite } from "./team";

/**
 * A company's team, managed by its Approvers (callers check that first).
 * Invites create the sign-in account directly (no Supabase invite email, whose
 * link depends on the browser that asked for it) and send Lufer's own email;
 * the colleague then signs in with the usual email link.
 */

export class TeamError extends Error {}

export interface TeamMember {
  id: string;
  email: string;
  role: string | null;
  /** Added but hasn't signed in yet. */
  pending: boolean;
}

function db() {
  if (dataSource() !== "supabase") throw new TeamError("Team invites need the live database.");
  return createAdminClient();
}

async function authUsers(): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

export async function listTeam(companyId: string): Promise<TeamMember[]> {
  const { data, error } = await db().from("platform_users").select("user_id, corporate_role").eq("role", "CLIENT").eq("company_id", companyId);
  if (error) throw error;
  const users = new Map((await authUsers()).map((u) => [u.id, u]));
  return data
    .map((r) => {
      const u = users.get(r.user_id);
      return { id: r.user_id, email: u?.email ?? r.user_id, role: r.corporate_role, pending: !u?.last_sign_in_at };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** Adds a colleague to the company and emails them. Refuses addresses that already have a Lufer role. */
export async function inviteTeammate(company: { id: string; legal_name: string }, inviterEmail: string, invite: TeamInvite): Promise<{ emailed: boolean }> {
  const supabase = db();
  let userId: string | null = null;
  const { data, error } = await supabase.auth.admin.createUser({ email: invite.email, email_confirm: true });
  if (!error) userId = data.user.id;
  else if (error.code === "email_exists" || error.status === 422) userId = (await authUsers()).find((u) => u.email?.toLowerCase() === invite.email)?.id ?? null;
  else throw error;
  if (!userId) throw new TeamError("Couldn't add that address.");

  const { data: existing, error: lookupError } = await supabase.from("platform_users").select("company_id").eq("user_id", userId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) throw new TeamError(existing.company_id === company.id ? "They're already on your team." : "That address already has a Lufer account elsewhere.");

  const { error: insertError } = await supabase.from("platform_users").insert({ user_id: userId, role: "CLIENT", company_id: company.id, corporate_role: invite.role });
  if (insertError) throw insertError;
  // A signup they started themselves is settled by the invite (it would otherwise wait for Lufer review).
  await supabase
    .from("signup_applications")
    .update({ status: "active", reviewed_at: new Date().toISOString(), company_id: company.id })
    .eq("user_id", userId)
    .eq("status", "pending_approval");

  const signInUrl = new URL(`/login?email=${encodeURIComponent(invite.email)}`, siteUrl("https://lufer.app")).toString();
  const outcome = await notifyTeamInvite(invite.email, inviteMessage({ companyName: company.legal_name.replace(/ Private Limited$/i, ""), inviterEmail, role: invite.role, signInUrl }), signInUrl);
  return { emailed: outcome.status === "sent" };
}

/** Removes a colleague's access to the company (their sign-in account stays). */
export async function removeTeammate(companyId: string, actorId: string, targetId: string): Promise<void> {
  const team = await listTeam(companyId);
  const target = team.find((m) => m.id === targetId);
  const refusal = removalRefusal(actorId, target ?? { id: targetId, role: null }, team);
  if (refusal) throw new TeamError(refusal);
  // Off the approval chain first (the rest move up a tier), so sign-offs don't route to someone who left.
  const chain = await getHierarchy(companyId);
  if (chain.some((t) => t.userId === targetId)) await saveHierarchy(companyId, chain.filter((t) => t.userId !== targetId).map((t) => t.userId));
  const { error } = await db().from("platform_users").delete().eq("user_id", targetId).eq("company_id", companyId).eq("role", "CLIENT");
  if (error) throw error;
}
