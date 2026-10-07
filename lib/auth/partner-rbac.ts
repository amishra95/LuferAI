/**
 * Partner extranet RBAC: three roles inside a partner organisation, plus
 * platform admins who may act for any partner. Pure (tested in
 * tests/partner-rbac.test.mjs); enforced by lib/auth/session.ts
 * (requirePartner), every /partner server action, and RLS.
 *
 *   OWNER   → everything, including the team (invite, change roles, remove)
 *   MANAGER → listings and rate cards, read the activity log
 *   STAFF   → read-only, plus pausing/resuming a listing (day-to-day operations)
 */
import type { PortalRole } from "@/lib/supabase/database.types";

export const PARTNER_ROLES = ["OWNER", "MANAGER", "STAFF"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export type PartnerPermission =
  | "partner.view"
  | "listing.status"
  | "listing.edit"
  | "rates.edit"
  | "audit.view"
  | "team.manage";

const GRANTS: Record<PartnerRole, readonly PartnerPermission[]> = {
  OWNER: ["partner.view", "listing.status", "listing.edit", "rates.edit", "audit.view", "team.manage"],
  MANAGER: ["partner.view", "listing.status", "listing.edit", "rates.edit", "audit.view"],
  STAFF: ["partner.view", "listing.status"],
};

export const PARTNER_ROLE_LABEL: Record<PartnerRole, string> = { OWNER: "Owner", MANAGER: "Manager", STAFF: "Staff" };

export interface PartnerActor {
  role: PortalRole | null | undefined;
  partnerRole: PartnerRole | null | undefined;
}

export function isPartnerRole(value: unknown): value is PartnerRole {
  return typeof value === "string" && (PARTNER_ROLES as readonly string[]).includes(value);
}

/** Platform admins hold every permission; partner users hold their role's grants; nobody else any. */
export function partnerCan(actor: PartnerActor, permission: PartnerPermission): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "PARTNER" || !actor.partnerRole) return false;
  return GRANTS[actor.partnerRole].includes(permission);
}

/** Every permission the actor holds, for rendering (hide what they can't do). */
export function partnerPermissions(actor: PartnerActor): Set<PartnerPermission> {
  const all = new Set<PartnerPermission>(GRANTS.OWNER);
  return new Set([...all].filter((p) => partnerCan(actor, p)));
}

/**
 * Would changing (or removing, nextRole = null) a member leave the partner
 * without an Owner? Team changes that would are refused, so a partner can
 * always manage itself.
 */
export function wouldOrphanPartner(
  members: readonly { userId: string; partnerRole: PartnerRole }[],
  change: { userId: string; nextRole: PartnerRole | null }
): boolean {
  const owners = members.filter((m) => m.partnerRole === "OWNER" && m.userId !== change.userId).length;
  return owners === 0 && change.nextRole !== "OWNER";
}
