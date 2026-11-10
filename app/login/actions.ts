"use server";

import type { AuthError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { landingAfterSignIn } from "@/lib/auth/landing";
import { safeNextPath } from "@/lib/auth/roles";
import { emailDomain } from "@/lib/auth/sso";
import { siteUrl } from "@/lib/site-url";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface MagicLinkState {
  status: "idle" | "sent" | "error";
  message?: string;
  /** Where the email went (status "sent"): the code form verifies against it. */
  email?: string;
  /** Where the code form lands them: /password after "Forgot password?". */
  next?: string;
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

export interface SsoState {
  status: "idle" | "error";
  message?: string;
}

/**
 * Enterprise SSO: sends the browser to the identity provider Supabase has for
 * the email's domain (SAML, set up per company). First sign-ins are given a
 * membership in /auth/callback when the domain is connected to a company.
 */
export async function signInWithSso(_prev: SsoState, formData: FormData): Promise<SsoState> {
  const domain = emailDomain(String(formData.get("email") ?? ""));
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!domain) return { status: "error", message: "Enter your work email address." };
  if (!isAuthConfigured()) return { status: "error", message: "Sign-in is unavailable: Supabase isn't configured." };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithSSO({ domain, options: { redirectTo: await callbackUrl(next) } });
  if (error || !data?.url) {
    if (error) logAuthError("signInWithSSO", error);
    return { status: "error", message: `Single sign-on isn't set up for ${domain}. Use an email link instead, or ask your IT team.` };
  }
  redirect(data.url);
}

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  // "Forgot password?": the same sign-in link, landing on /password to set a new one.
  const intent = formData.get("intent");
  const reset = intent === "reset";
  const next = reset ? "/password" : safeNextPath(String(formData.get("next") ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", message: "Enter your email address first." };
  if (!isAuthConfigured()) return { status: "error", message: "Sign-in is unavailable: Supabase isn't configured." };

  const supabase = await createClient();
  // Signed up but never confirmed: send the confirmation email again.
  if (intent === "confirm") {
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: await callbackUrl(next) } });
    if (error) {
      logAuthError("resend", error);
      return { status: "error", message: magicLinkErrorMessage(error) };
    }
    return { status: "sent", email, next: next ?? "", message: `We sent a new confirmation email to ${email}.` };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Accounts are made at /signup (or by an admin); this form never creates one.
    options: { emailRedirectTo: await callbackUrl(next), shouldCreateUser: false },
  });
  if (error) {
    logAuthError("signInWithOtp", error);
    return { status: "error", message: magicLinkErrorMessage(error) };
  }
  return {
    status: "sent",
    email,
    next: next ?? "",
    message: reset ? `Check ${email} for a link to set a new password.` : `Check ${email} for a sign-in link.`,
  };
}

export interface PasswordState {
  status: "idle" | "error";
  message?: string;
  /** Right password, email never confirmed: the form offers to resend the confirmation. */
  unconfirmed?: boolean;
}

/**
 * Email + password sign-in. The account's email must be confirmed first
 * (Supabase refuses otherwise), so a password never skips the email check;
 * it only saves opening a link on every later sign-in.
 */
export async function signInWithPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", message: "Enter a valid email address." };
  if (!password) return { status: "error", message: "Enter your password." };
  if (!isAuthConfigured()) return { status: "error", message: "Sign-in is unavailable: Supabase isn't configured." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    logAuthError("signInWithPassword", error);
    if (error.code === "email_not_confirmed") {
      return { status: "error", unconfirmed: true, message: "Confirm your email first: open the link we sent you." };
    }
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many attempts. Wait a minute, then try again." };
    }
    if (error.status !== undefined && error.status >= 500) {
      return { status: "error", message: "Sign-in isn't working right now. Please try again shortly." };
    }
    return { status: "error", message: "Wrong email or password." };
  }
  redirect(await landingAfterSignIn(supabase, next));
}

export interface CodeState {
  status: "idle" | "error";
  message?: string;
}

/**
 * The 6-digit code from a sign-in or confirmation email, for when the link
 * won't do: opened on another device, or already used up by a corporate mail
 * scanner that "clicks" links to check them.
 */
export async function verifyEmailCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!/^\d{6,10}$/.test(token)) return { status: "error", message: "Enter the code from the email." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", message: "Start again from the sign-in page." };
  if (!isAuthConfigured()) return { status: "error", message: "Sign-in is unavailable: Supabase isn't configured." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    logAuthError("verifyOtp", error);
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many attempts. Wait a minute, then try again." };
    }
    return { status: "error", message: "That code is wrong or has expired." };
  }
  redirect(await landingAfterSignIn(supabase, next));
}

export async function signOut() {
  if (!isAuthConfigured()) redirect("/login");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
