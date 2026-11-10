"use server";

import { headers } from "next/headers";

import { PENDING_PATH } from "@/lib/auth/onboarding";
import { passwordProblem } from "@/lib/auth/password";
import { parseSignupInput, type SignupField } from "@/lib/auth/signup-input";
import { siteUrl } from "@/lib/site-url";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface SignupState {
  status: "idle" | "sent" | "error";
  message?: string;
  fieldErrors?: Partial<Record<SignupField | "account_type" | "password", string>>;
  /** Where the confirmation went (status "sent"): the code form verifies against it. */
  email?: string;
}

/**
 * Creates the account with the chosen password and emails a confirmation
 * link. The form's details go in the new user's metadata; /auth/callback
 * records and activates the application once the link proves the email is
 * theirs. Nothing grants access before then, and password sign-in is refused
 * until the email is confirmed.
 *
 * An address that already has an account gets an ordinary sign-in link
 * instead (its password is left alone), and the reply is the same either way,
 * so the form doesn't reveal who has an account.
 */
export async function submitSignup(_prev: SignupState, form: FormData): Promise<SignupState> {
  const { password: rawPassword, ...fields } = Object.fromEntries(form);
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const parsed = parseSignupInput(fields);
  const passwordError = passwordProblem(password);
  if (!parsed.ok || passwordError) {
    const fieldErrors = { ...(parsed.ok ? {} : parsed.errors), ...(passwordError ? { password: passwordError } : {}) };
    return { status: "error", fieldErrors, message: "Please fix the highlighted fields." };
  }
  if (!isAuthConfigured()) return { status: "error", message: "Signup is unavailable: Supabase isn't configured." };

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const redirect = new URL("/auth/callback", siteUrl(origin));
  redirect.searchParams.set("next", PENDING_PATH);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.value.email,
    password,
    options: { emailRedirectTo: redirect.toString(), data: { signup: parsed.value, name: parsed.value.full_name } },
  });
  // Already registered: Supabase returns a stand-in user with no identities and sends nothing.
  const existing = !error && data.user && (data.user.identities?.length ?? 0) === 0;
  const fallback = existing
    ? await supabase.auth.signInWithOtp({ email: parsed.value.email, options: { shouldCreateUser: false, emailRedirectTo: redirect.toString() } })
    : null;
  const failure = error ?? fallback?.error ?? null;
  if (failure) {
    console.error("signup: failed", { code: failure.code, status: failure.status, message: failure.message });
    if (failure.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." }, message: "Please fix the highlighted fields." };
    }
    if (failure.status === 429 || failure.code === "over_email_send_rate_limit" || failure.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many emails were requested. Wait a minute, then try again." };
    }
    return { status: "error", message: "We couldn't send the confirmation email. Please try again shortly." };
  }
  return { status: "sent", email: parsed.value.email, message: `Check ${parsed.value.email} and open the link to confirm it's you. Next time, sign in with your password.` };
}
