"use server";

import type { AuthError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/roles";
import { siteUrl } from "@/lib/site-url";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface MagicLinkState {
  status: "idle" | "sent" | "error";
  message?: string;
}

/** Absolute /auth/callback URL for this deployment, carrying the post-login destination. */
async function callbackUrl(next: string | null) {
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const url = new URL("/auth/callback", siteUrl(origin));
  if (next) url.searchParams.set("next", next);
  return url.toString();
}

/** Server log line for a failed auth call; omits the email address. */
function logAuthError(action: string, error: AuthError) {
  console.error(`auth: ${action} failed`, { code: error.code, status: error.status, message: error.message });
}

/**
 * User-facing message for a failed signInWithOtp. Unknown and unprovisioned
 * addresses share one message so the form doesn't reveal which accounts exist.
 */
function magicLinkErrorMessage(error: AuthError): string {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "Too many sign-in emails were requested. Wait a minute, then try again.";
  }
  if (error.code === "email_address_invalid") return "Enter a valid email address.";
  if (error.status !== undefined && error.status >= 500) {
    return "Sign-in email couldn't be sent right now. Please try again shortly.";
  }
  return "We couldn't send a sign-in link to that address.";
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!isAuthConfigured()) redirect("/login?error=auth_unconfigured");
  const supabase = await createClient();
  // PKCE: the code verifier is stored in a cookie here and consumed by /auth/callback.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: await callbackUrl(next) },
  });
  if (error) logAuthError("signInWithOAuth", error);
  if (error || !data.url) redirect("/login?error=oauth_failed");
  redirect(data.url);
}

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", message: "Enter a valid email address." };
  if (!isAuthConfigured()) return { status: "error", message: "Sign-in is unavailable: Supabase isn't configured." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Portal accounts are provisioned by an admin (platform_users); don't self-register.
    options: { emailRedirectTo: await callbackUrl(next), shouldCreateUser: false },
  });
  if (error) {
    logAuthError("signInWithOtp", error);
    return { status: "error", message: magicLinkErrorMessage(error) };
  }
  return { status: "sent", message: `Check ${email} for a sign-in link.` };
}

export async function signOut() {
  if (!isAuthConfigured()) redirect("/login");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
