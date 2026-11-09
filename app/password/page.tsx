import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { homeFor } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { isAuthConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "./_components/password-form";

export const metadata: Metadata = { title: "Password" };

/**
 * Set or change a password. Accounts made before passwords existed (email
 * links only) set one here; "Forgot password?" on /login emails a sign-in
 * link that lands here.
 */
export default async function PasswordPage() {
  if (!isAuthConfigured()) redirect("/login?error=auth_unconfigured");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!data?.claims?.sub || !email) redirect("/login?next=/password");

  const member = await getCurrentMember();
  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm email={email} home={member ? homeFor(member.role) : "/"} />
        </CardContent>
      </Card>
    </AuthShell>
  );
}
