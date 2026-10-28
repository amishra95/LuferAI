import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccess, homeFor, portalFor, safeNextPath } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  no_access: "Your account isn't linked to a portal yet. Apply for an account below, or ask a platform admin to grant access.",
  link_invalid: "That sign-in link is invalid or has expired. Request a new one.",
  oauth_failed: "Google sign-in couldn't be started. Please try again.",
  auth_unconfigured: "Sign-in is unavailable: Supabase isn't configured (see .env.example).",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: nextParam, error } = await searchParams;
  const next = safeNextPath(typeof nextParam === "string" ? nextParam : null);

  // Already signed in with a portal role → skip the form.
  const member = await getCurrentMember();
  if (member) {
    const nextPortal = next ? portalFor(next.split("?")[0]) : null;
    redirect(next && (!nextPortal || canAccess(member.role, nextPortal)) ? next : homeFor(member.role));
  }

  const errorMessage = typeof error === "string" ? ERRORS[error] : undefined;

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Lufer</CardTitle>
          <CardDescription>Use your work Google account or get a one-time link by email.</CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p role="alert" className="text-destructive mb-4 text-body">
              {errorMessage}
            </p>
          ) : null}
          <LoginForm next={next ?? ""} />
        </CardContent>
      </Card>
      <p className="text-fg-subtle text-center text-meta">
        New to Lufer?{" "}
        <Link href="/signup" className="text-link underline-offset-2 hover:underline">
          Apply for an account
        </Link>
      </p>
    </AuthShell>
  );
}
