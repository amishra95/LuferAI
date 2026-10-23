import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { homeFor } from "@/lib/auth/roles";
import { currentApplicationStatus, getCurrentMember } from "@/lib/auth/session";
import { landingFor, type AccountType } from "@/lib/auth/onboarding";
import { cn } from "@/lib/utils";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = { title: "Apply for an account" };

const COPY: Record<AccountType, { title: string; description: string }> = {
  enterprise: { title: "Book corporate events", description: "For companies buying venues, catering and experiences for their teams." },
  partner: { title: "Offer your services", description: "For artists, experience studios, caterers and other event suppliers." },
};

/** Public signup: enterprise buyers and partners apply; a platform admin approves each account. */
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  // Already in: their portal. Already applied: the waiting room.
  const member = await getCurrentMember();
  if (member) redirect(homeFor(member.role));
  const applied = await currentApplicationStatus();
  if (applied) redirect(landingFor(null, applied));

  const { type } = await searchParams;
  const accountType: AccountType = type === "partner" ? "partner" : "enterprise";

  return (
    <AuthShell wide>
      <nav aria-label="Account type" className="border-line grid grid-cols-2 gap-1 rounded-md border p-1">
        {(["enterprise", "partner"] as const).map((t) => (
          <Link
            key={t}
            href={`/signup?type=${t}`}
            aria-current={accountType === t ? "page" : undefined}
            className={cn("flex min-h-10 items-center justify-center rounded text-meta", accountType === t ? "bg-surface-raised text-fg font-medium" : "text-fg-subtle hover:text-fg")}
          >
            {t === "enterprise" ? "I'm a company" : "I'm a partner"}
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>{COPY[accountType].title}</CardTitle>
          <CardDescription>{COPY[accountType].description} We review every application, usually within one working day.</CardDescription>
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
