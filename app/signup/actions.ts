"use server";

import { headers } from "next/headers";

import { PENDING_PATH } from "@/lib/auth/onboarding";
import { parseSignupInput, type SignupField } from "@/lib/auth/signup-input";
import { siteUrl } from "@/lib/site-url";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface SignupState {
  status: "idle" | "sent" | "error";
  message?: string;
  fieldErrors?: Partial<Record<SignupField | "account_type", string>>;
}

/**
 * Sends the applicant a magic link that creates their account. The form's
 * details go in the new user's metadata; /auth/callback records the
 * application once the link proves the email is theirs. Nothing grants
 * access: that's an admin's approval (/admin/approvals).
 *
 * An address that already has an account gets an ordinary sign-in link
 * (Supabase ignores the metadata then), and the reply is the same either way,
 * so the form doesn't reveal who has an account.
 */
export async function submitSignup(_prev: SignupState, form: FormData): Promise<SignupState> {
  const parsed = parseSignupInput(Object.fromEntries(form));
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.errors, message: "Please fix the highlighted fields." };
  if (!isAuthConfigured()) return { status: "error", message: "Signup is unavailable: Supabase isn't configured." };

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const redirect = new URL("/auth/callback", siteUrl(origin));
  redirect.searchParams.set("next", PENDING_PATH);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.value.email,
    options: { shouldCreateUser: true, emailRedirectTo: redirect.toString(), data: { signup: parsed.value, name: parsed.value.full_name } },
  });
  if (error) {
    console.error("signup: signInWithOtp failed", { code: error.code, status: error.status, message: error.message });
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many emails were requested. Wait a minute, then try again." };
    }
    return { status: "error", message: "We couldn't send the confirmation email. Please try again shortly." };
  }
  return { status: "sent", message: `Check ${parsed.value.email} and open the link to confirm it's you. We'll review your application once you do.` };
}
