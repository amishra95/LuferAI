import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccess, homeFor, portalFor, safeNextPath } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  no_access: "This account has no access yet. Create an account below.",
  link_invalid: "That link has expired or was already used. Sign in below, or request a new link.",
  oauth_failed: "Google sign-in failed. Try again.",
  auth_unconfigured: "Sign-in is unavailable: Supabase isn't configured (see .env.example).",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: nextParam, error, email: emailParam } = await searchParams;
  const email = typeof emailParam === "string" && /^[^\s@]+@[^\s@]+$/.test(emailParam) ? emailParam.slice(0, 254) : undefined;
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
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p role="alert" className="text-destructive mb-4 text-body">
              {errorMessage}
            </p>
          ) : null}
          <LoginForm next={next ?? ""} email={email} />
        </CardContent>
      </Card>
      <p className="text-fg-subtle text-center text-meta">
        New to Lufer?{" "}
        <Link href="/signup" className="text-link underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
