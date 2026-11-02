import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { homeFor } from "@/lib/auth/roles";
import { currentApplicationStatus, getCurrentMember } from "@/lib/auth/session";
import { ACCOUNT_TYPES, isAccountType, landingFor, type AccountType } from "@/lib/auth/onboarding";
import { cn } from "@/lib/utils";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = { title: "Create an account" };

const COPY: Record<AccountType, { tab: string; title: string; description: string }> = {
  enterprise: { tab: "Hosting events", title: "Plan corporate events", description: "For companies booking venues, catering and experiences for their teams." },
  venue: { tab: "I own a venue", title: "List your venue", description: "For restaurants, bars, banquet halls and other venues that host corporate events." },
  partner: { tab: "Supplier", title: "Offer your services", description: "For artists, experience studios, caterers and other event suppliers." },
};

const NEXT_STEP: Record<AccountType, string> = {
  enterprise: "Confirm your email and you can start planning straight away.",
  venue: "Confirm your email and you can set up your venue straight away. Companies see it once we've verified it, usually within one working day.",
  partner: "Confirm your email and you can set up your offerings straight away.",
};

/** Public signup: companies hosting events, venue owners and suppliers. Accounts open once the email is confirmed. */
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  // Already in: their portal. Already applied: the waiting room.
  const member = await getCurrentMember();
  if (member) redirect(homeFor(member.role));
  const applied = await currentApplicationStatus();
  if (applied) redirect(landingFor(null, applied));

  const { type } = await searchParams;
  const accountType: AccountType = isAccountType(type) ? type : "enterprise";

  return (
    <AuthShell wide>
      <nav aria-label="Account type" className="border-line grid grid-cols-3 gap-1 rounded-md border p-1">
        {ACCOUNT_TYPES.map((t) => (
          <Link
            key={t}
            href={`/signup?type=${t}`}
            aria-current={accountType === t ? "page" : undefined}
            className={cn("flex min-h-10 items-center justify-center rounded text-meta", accountType === t ? "bg-surface-raised text-fg font-medium" : "text-fg-subtle hover:text-fg")}
          >
            {COPY[t].tab}
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>{COPY[accountType].title}</CardTitle>
          <CardDescription>
            {COPY[accountType].description} {NEXT_STEP[accountType]}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm key={accountType} accountType={accountType} />
        </CardContent>
      </Card>
      <p className="text-fg-subtle text-center text-meta">
        Already have an account?{" "}
        <Link href="/login" className="text-link underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
