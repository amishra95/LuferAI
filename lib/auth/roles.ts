import type { PortalRole } from "@/lib/supabase/database.types";

/**
 * Portal RBAC rules, shared by middleware.ts (Edge) and server code — keep this file
 * free of Node/server-only imports.
 *
 * DB enum `portal_role` → product role:
 *   CLIENT   → client            → /client only
 *   PROPERTY → property_manager  → /property only
 *   ADMIN    → admin             → every portal
 */

export const PORTALS = ["/client", "/property", "/admin"] as const;
export type Portal = (typeof PORTALS)[number];

const PORTAL_ACCESS: Record<PortalRole, readonly Portal[]> = {
  CLIENT: ["/client"],
  PROPERTY: ["/property"],
  ADMIN: PORTALS,
};

const HOME: Record<PortalRole, Portal> = {
  CLIENT: "/client",
  PROPERTY: "/property",
  ADMIN: "/admin",
};

/** The protected portal a pathname belongs to, or null for public routes. */
export function portalFor(pathname: string): Portal | null {
  return PORTALS.find((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? null;
}

export function canAccess(role: PortalRole | null | undefined, portal: Portal): boolean {
  return role ? PORTAL_ACCESS[role].includes(portal) : false;
}

export function homeFor(role: PortalRole): Portal {
  return HOME[role];
}

/** Only same-origin absolute paths are allowed as post-login destinations (no open redirects). */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}
