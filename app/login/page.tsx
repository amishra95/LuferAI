import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccess, homeFor, portalFor, safeNextPath } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  no_access: "Your account isn't linked to a portal yet. Ask a platform admin to grant access.",
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
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 pt-[calc(4rem+var(--app-safe-top))] pb-[calc(4rem+var(--app-safe-bottom))]">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to CorpHospitality</CardTitle>
          <CardDescription>Use your work Google account or get a one-time link by email.</CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {errorMessage}
            </p>
          ) : null}
          <LoginForm next={next ?? ""} />
        </CardContent>
      </Card>
    </main>
  );
}
