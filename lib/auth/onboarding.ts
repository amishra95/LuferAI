import type { PortalRole } from "@/lib/supabase/database.types";

import { homeFor, type Portal } from "./roles.ts";

/**
 * Self-service signup states and where they send people, shared by
 * middleware.ts (Edge), /auth/callback and the portal guards: keep this file
 * free of Node/server-only imports.
 *
 *   no portal role, applied          → /signup/pending (received, or not approved)
 *   no portal role, never applied    → /login?error=no_access
 *   approved                         → their portal: enterprise /client, partner /partner
 *
 * Approval creates the platform_users row (decide_signup_application), so an
 * approved applicant is routed by their role like everyone else.
 */

export const ACCOUNT_TYPES = ["enterprise", "partner"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const APPLICATION_STATUSES = ["pending_approval", "active", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const isApplicationStatus = (v: unknown): v is ApplicationStatus => typeof v === "string" && (APPLICATION_STATUSES as readonly string[]).includes(v);

export const PENDING_PATH = "/signup/pending";
export const NO_ACCESS_PATH = "/login?error=no_access";

/** Each account type's portal once approved. */
export const ACCOUNT_HOME: Record<AccountType, Portal> = { enterprise: "/client", partner: "/partner" };

/**
 * Where a signed-in user goes when a page needs a portal role: their role's
 * home, else the waiting room while their application is pending or was
 * rejected, else "no access". An approved application without a role means
 * access was removed since: "no access" too (never the waiting room, which
 * would send them back to a portal that sends them back).
 */
export function landingFor(role: PortalRole | null | undefined, application: ApplicationStatus | null | undefined): string {
  if (role) return homeFor(role);
  return application === "pending_approval" || application === "rejected" ? PENDING_PATH : NO_ACCESS_PATH;
}
