import type { PortalRole } from "@/lib/supabase/database.types";

import { homeFor, type Portal } from "./roles.ts";

/**
 * Self-service signup states and where they send people, shared by
 * proxy.ts, /auth/callback and the portal guards: keep this file
 * free of Node/server-only imports.
 *
 *   no portal role, applied          → /signup/pending (an admin must decide, or not approved)
 *   no portal role, never applied    → /login?error=no_access
 *   active                           → their portal: enterprise /client, venue /property, partner /partner
 *
 * Most signups are active the moment their email is verified
 * (activate_signup_application); those joining an existing company or venue
 * wait for an admin. Activation creates the platform_users row, so an active
 * applicant is routed by their role like everyone else.
 */

export const ACCOUNT_TYPES = ["enterprise", "venue", "partner"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const APPLICATION_STATUSES = ["pending_approval", "active", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const isApplicationStatus = (v: unknown): v is ApplicationStatus => typeof v === "string" && (APPLICATION_STATUSES as readonly string[]).includes(v);

export const PENDING_PATH = "/signup/pending";
export const NO_ACCESS_PATH = "/login?error=no_access";

export const isAccountType = (v: unknown): v is AccountType => typeof v === "string" && (ACCOUNT_TYPES as readonly string[]).includes(v);

/** Each account type's portal once active. */
export const ACCOUNT_HOME: Record<AccountType, Portal> = { enterprise: "/client", venue: "/property", partner: "/partner" };

/** Where a just-activated signup lands first: a welcome page for companies and venues, the portal for partners. */
export const WELCOME_PATH: Record<AccountType, string> = { enterprise: "/client/welcome", venue: "/property/welcome", partner: "/partner" };

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
