"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/roles";
import { siteUrl } from "@/lib/site-url";
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

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  // PKCE: the code verifier is stored in a cookie here and consumed by /auth/callback.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: await callbackUrl(next) },
  });
  if (error || !data.url) redirect("/login?error=oauth_failed");
  redirect(data.url);
}

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", message: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Portal accounts are provisioned by an admin (platform_users); don't self-register.
    options: { emailRedirectTo: await callbackUrl(next), shouldCreateUser: false },
  });
  if (error) return { status: "error", message: "We couldn't send a sign-in link to that address." };
  return { status: "sent", message: `Check ${email} for a sign-in link.` };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
