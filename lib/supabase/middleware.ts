import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canAccess, canAccessWorkspace, homeFor, portalFor, workspaceRouteFor } from "@/lib/auth/roles";
import { isAiApiPath, limitAiRequest } from "@/lib/ratelimit";
import type { Database, PortalRole } from "./database.types";
import { clean, isHttpUrl } from "./env";

/**
 * Refreshes the Supabase session cookie on every matched request and gates the portals:
 * - signed out            → /login?next=<path>
 * - signed in, no role    → /login?error=no_access
 * - signed in, wrong role → that role's own portal
 * Workspace areas (/dashboard, /settings, /agents, /chat, /venues) are gated the
 * same way, by portal role plus corporate role (lib/auth/roles.ts).
 * It also rate-limits /api/ai/* per user (or per IP when signed out) — see lib/ratelimit.ts.
 *
 * This is the optimistic first line; portal layouts and server actions re-check via
 * lib/auth/session.ts, and RLS backs both.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const portal = portalFor(request.nextUrl.pathname);
  const workspace = workspaceRouteFor(request.nextUrl.pathname);
  const gated = portal ?? workspace;

  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  // A malformed URL would make createServerClient throw on every request; treat it
  // as unconfigured instead (portals fail closed to /login, public pages still load).
  if (!url || !anonKey || !isHttpUrl(url)) {
    if (isAiApiPath(request.nextUrl.pathname)) return (await limitAiRequest(request, null)) ?? response;
    // Auth can't work without Supabase — fail closed rather than expose the portals.
    return gated ? redirectToLogin(request, response, { error: "auth_unconfigured" }) : response;
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims() verifies the JWT (unlike getSession()) and refreshes it if expired.
  // Nothing may run between createServerClient and this call, or sessions get dropped.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (isAiApiPath(request.nextUrl.pathname)) {
    const limited = await limitAiRequest(request, userId ?? null);
    return limited ? withSessionCookies(limited, response) : response;
  }
  if (!gated) return response;
  if (!userId) {
    return redirectToLogin(request, response, { next: request.nextUrl.pathname + request.nextUrl.search });
  }

  // RLS policy "users read own membership" lets the user's own client read this row.
  const { data: member } = await supabase
    .from("platform_users")
    .select("role, corporate_role")
    .eq("user_id", userId)
    .maybeSingle();
  const role: PortalRole | undefined = member?.role;

  if (!role) return redirectToLogin(request, response, { error: "no_access" });
  const allowed = portal ? canAccess(role, portal) : canAccessWorkspace(role, member?.corporate_role, workspace!);
  if (!allowed) return withSessionCookies(NextResponse.redirect(new URL(homeFor(role), request.url)), response);

  return response;
}

function redirectToLogin(request: NextRequest, response: NextResponse, params: Record<string, string>) {
  const target = new URL("/login", request.url);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return withSessionCookies(NextResponse.redirect(target), response);
}

/** Carries any refreshed session cookies on `response` over to a redirect or error response. */
function withSessionCookies(redirect: NextResponse, response: NextResponse) {
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  // @supabase/ssr sets no-store headers alongside refreshed cookies so CDNs never cache them.
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(key);
    if (value) redirect.headers.set(key, value);
  }
  return redirect;
}
