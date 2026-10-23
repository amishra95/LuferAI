import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { isApplicationStatus, landingFor } from "@/lib/auth/onboarding";
import { canAccess, homeFor, portalFor, safeNextPath } from "@/lib/auth/roles";
import { parseSignupInput } from "@/lib/auth/signup-input";
import { createSignupApplication, getSignupApplication } from "@/lib/data";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Lands both sign-in methods:
 * - ?code=…                 Google OAuth and same-browser magic links (PKCE)
 * - ?token_hash=…&type=…    magic links opened on another device; needs the email template
 *                           to link to {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
 *
 * Members go to their portal. Someone without a portal role who signed up at
 * /signup has their application recorded here, now that the link proved the
 * email is theirs (the form's details ride in the new user's metadata), and
 * goes to /signup/pending until an admin approves it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));
  if (!isAuthConfigured()) return NextResponse.redirect(new URL("/login?error=auth_unconfigured", request.url));

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing auth code") };

  if (error) {
    // Supabase reports failed verifications (e.g. otp_expired) as error_code on this URL.
    console.error("auth: callback failed", {
      message: error.message,
      code: "code" in error ? error.code : undefined,
      providerErrorCode: searchParams.get("error_code"),
      providerError: searchParams.get("error_description"),
    });
    return NextResponse.redirect(new URL("/login?error=link_invalid", request.url));
  }

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub ?? "";
  const { data: member } = await supabase
    .from("platform_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return NextResponse.redirect(new URL(await applicantLanding(supabase, userId), request.url));

  // Honour ?next only if this role may open it; otherwise go to the role's own portal.
  const nextPortal = next ? portalFor(new URL(next, request.url).pathname) : null;
  const destination = next && (!nextPortal || canAccess(member.role, nextPortal)) ? next : homeFor(member.role);
  return NextResponse.redirect(new URL(destination, request.url));
}

/**
 * Where someone without a portal role lands: the waiting room once they have
 * an application (recording it first if they've just verified a signup), else
 * "no access". Never throws: a failure here only costs them the waiting room.
 */
async function applicantLanding(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string> {
  if (!userId) return landingFor(null, null);
  try {
    let application = await getSignupApplication(userId);
    if (!application) {
      const { data } = await supabase.auth.getUser();
      const signup = data.user?.user_metadata?.signup;
      // The verified address, not whatever the form carried.
      const parsed = signup && data.user?.email ? parseSignupInput({ ...signup, email: data.user.email }) : null;
      if (parsed?.ok) application = await createSignupApplication(userId, parsed.value);
    }
    return landingFor(null, isApplicationStatus(application?.status) ? application.status : null);
  } catch (err) {
    console.error("auth: could not record the signup application", err);
    return landingFor(null, null);
  }
}
