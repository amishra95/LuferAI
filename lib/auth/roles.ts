import type { CorporateRole, PortalRole } from "@/lib/supabase/database.types";

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

/**
 * Workspace areas outside the portals. "admin" areas expose platform-wide data or
 * secrets (settings, agent config, telemetry); "booker" areas also admit client
 * users who can request bookings (Organizers and Approvers, not Finance viewers).
 */
export const WORKSPACE_ROUTES = ["/dashboard", "/settings", "/agents", "/chat", "/venues"] as const;
export type WorkspaceRoute = (typeof WORKSPACE_ROUTES)[number];

const WORKSPACE_ACCESS: Record<WorkspaceRoute, "admin" | "booker"> = {
  "/dashboard": "admin",
  "/settings": "admin",
  "/agents": "admin",
  "/chat": "booker",
  "/venues": "booker",
};

const BOOKERS: readonly CorporateRole[] = ["ORGANIZER", "APPROVER"];

/** The workspace area a pathname belongs to, or null. */
export function workspaceRouteFor(pathname: string): WorkspaceRoute | null {
  return WORKSPACE_ROUTES.find((r) => pathname === r || pathname.startsWith(`${r}/`)) ?? null;
}

export function canAccessWorkspace(
  role: PortalRole | null | undefined,
  corporateRole: CorporateRole | null | undefined,
  route: WorkspaceRoute
): boolean {
  if (role === "ADMIN") return true;
  return WORKSPACE_ACCESS[route] === "booker" && role === "CLIENT" && !!corporateRole && BOOKERS.includes(corporateRole);
}

/** Only same-origin absolute paths are allowed as post-login destinations (no open redirects). */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}
