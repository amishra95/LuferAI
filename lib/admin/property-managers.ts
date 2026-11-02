import "server-only";

import type { User } from "@supabase/supabase-js";

import type { ManagerInput } from "@/lib/admin/property-manager-input";
import { dataSource } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Property managers: platform_users rows with role PROPERTY, each linked to one
 * venue (venue_id). The property portal, its RLS (current_venue_id()) and the
 * live booking stream all read that link on every request, so assigning or
 * moving a manager takes effect at once.
 *
 * platform_users has no name, phone or status columns: name and phone live in
 * the auth user's metadata, and "inactive" is an auth ban, which stops sign-in
 * and token refresh (a session already open lasts until its access token
 * expires, up to an hour).
 */

/** Effectively permanent; "none" lifts it. */
const BAN = "876000h";

export class ManagerError extends Error {
  constructor(
    message: string,
    readonly field?: "email" | "venue_id"
  ) {
    super(message);
  }
}

export interface PropertyManager {
  userId: string;
  email: string;
  name: string | null;
  phone: string | null;
  venueId: string;
  active: boolean;
  /** Invited and hasn't accepted yet. */
  pending: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

function db() {
  if (dataSource() !== "supabase") throw new ManagerError("Managing property users needs Supabase (it creates sign-in accounts).");
  return createAdminClient();
}

const meta = (u: User, key: "name" | "phone") => (typeof u.user_metadata?.[key] === "string" && u.user_metadata[key] ? (u.user_metadata[key] as string) : null);
const banned = (u: User) => Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now());

async function authUsers(ids?: Set<string>): Promise<Map<string, User>> {
  const out = new Map<string, User>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (!ids || ids.has(u.id)) out.set(u.id, u);
    if (data.users.length < 1000 || (ids && out.size >= ids.size)) break;
  }
  return out;
}

export async function listPropertyManagers(): Promise<PropertyManager[]> {
  const { data, error } = await db().from("platform_users").select("user_id, venue_id, created_at").eq("role", "PROPERTY");
  if (error) throw error;
  const users = await authUsers(new Set(data.map((d) => d.user_id)));
  return data
    .map((d) => {
      const u = users.get(d.user_id);
      return {
        userId: d.user_id,
        email: u?.email ?? d.user_id,
        name: u ? meta(u, "name") : null,
        phone: u ? meta(u, "phone") : null,
        venueId: d.venue_id!,
        active: u ? !banned(u) : false,
        pending: Boolean(u && !u.last_sign_in_at && u.invited_at),
        lastSignInAt: u?.last_sign_in_at ?? null,
        createdAt: d.created_at,
      };
    })
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

async function assertVenue(venueId: string) {
  const { data, error } = await db().from("venues").select("id").eq("id", venueId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ManagerError("That venue doesn't exist.", "venue_id");
}

/**
 * Adds a property manager for a venue: emails an invite to a new address; an
 * existing account without a portal role is linked directly (they sign in as
 * usual). Accounts that already belong to a company, venue or partner are refused.
 */
export async function addPropertyManager(input: ManagerInput, redirectTo: string): Promise<{ userId: string; invited: boolean }> {
  const supabase = db();
  await assertVenue(input.venueId);
  const metadata = { name: input.name, ...(input.phone && { phone: input.phone }) };

  let userId: string | null = null;
  let invited = false;
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(input.email, { redirectTo, data: metadata });
  if (!error) {
    userId = data.user.id;
    invited = true;
  } else if (error.code === "email_exists" || error.status === 422) {
    userId = [...(await authUsers()).values()].find((u) => u.email?.toLowerCase() === input.email)?.id ?? null;
  } else {
    throw error;
  }
  if (!userId) throw new ManagerError("Couldn't invite that address.", "email");

  const { data: existing, error: lookupError } = await supabase.from("platform_users").select("role, venue_id").eq("user_id", userId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    throw new ManagerError(
      existing.role === "PROPERTY" ? "They already manage a venue: change their venue in the list instead." : "That person already has a Lufer account with another role.",
      "email"
    );
  }
  if (!invited) {
    // An existing account: keep what they had, fill in what the admin entered.
    const { error: metaError } = await supabase.auth.admin.updateUserById(userId, { user_metadata: metadata });
    if (metaError) throw metaError;
  }
  const { error: insertError } = await supabase.from("platform_users").insert({ user_id: userId, role: "PROPERTY", venue_id: input.venueId });
  if (insertError) throw insertError;
  return { userId, invited };
}

async function managerRow(userId: string) {
  const { data, error } = await db().from("platform_users").select("venue_id").eq("user_id", userId).eq("role", "PROPERTY").maybeSingle();
  if (error) throw error;
  if (!data) throw new ManagerError("That person isn't a property manager.");
  return data;
}

/** Moves a manager to another venue. Returns the venue they managed before. */
export async function assignVenue(userId: string, venueId: string): Promise<{ from: string | null }> {
  const row = await managerRow(userId);
  await assertVenue(venueId);
  const { error } = await db().from("platform_users").update({ venue_id: venueId }).eq("user_id", userId).eq("role", "PROPERTY");
  if (error) throw error;
  return { from: row.venue_id };
}

/** Deactivates (bans sign-in) or reactivates a manager. Their venue link is kept. */
export async function setManagerActive(userId: string, active: boolean): Promise<void> {
  await managerRow(userId);
  const { error } = await db().auth.admin.updateUserById(userId, { ban_duration: active ? "none" : BAN });
  if (error) throw error;
}
