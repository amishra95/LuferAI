import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { landingAfterSignIn } from "@/lib/auth/landing";
import { safeNextPath } from "@/lib/auth/roles";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Lands both sign-in methods:
 * - ?code=…                 Google OAuth and same-browser magic links (PKCE)
 * - ?token_hash=…&type=…    magic links opened on another device; needs the email template
 *                           to link to {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
 *
 * Signup confirmations land here too: the link proves the email is theirs, so
 * the application (its details ride in the new user's metadata) is recorded
 * and activated. Where everyone goes next: lib/auth/landing.ts.
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

  return NextResponse.redirect(new URL(await landingAfterSignIn(supabase, next), request.url));
}
