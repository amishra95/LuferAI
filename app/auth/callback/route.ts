import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { canAccess, homeFor, portalFor, safeNextPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * Lands both sign-in methods:
 * - ?code=…                 Google OAuth and same-browser magic links (PKCE)
 * - ?token_hash=…&type=…    magic links opened on another device; needs the email template
 *                           to link to {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing auth code") };

  if (error) return NextResponse.redirect(new URL("/login?error=link_invalid", request.url));

  const { data: claims } = await supabase.auth.getClaims();
  const { data: member } = await supabase
    .from("platform_users")
    .select("role")
    .eq("user_id", claims?.claims.sub ?? "")
    .maybeSingle();
  if (!member) return NextResponse.redirect(new URL("/login?error=no_access", request.url));

  // Honour ?next only if this role may open it; otherwise go to the role's own portal.
  const nextPortal = next ? portalFor(new URL(next, request.url).pathname) : null;
  const destination = next && (!nextPortal || canAccess(member.role, nextPortal)) ? next : homeFor(member.role);
  return NextResponse.redirect(new URL(destination, request.url));
}
