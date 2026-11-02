import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { homeFor } from "@/lib/auth/roles";
import { currentApplicationStatus, getCurrentMember } from "@/lib/auth/session";
import { isAccountType, landingFor, type AccountType } from "@/lib/auth/onboarding";
import { cn } from "@/lib/utils";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = { title: "Create an account" };

const COPY: Record<AccountType, { title: string; description: string }> = {
  enterprise: { title: "Plan corporate events", description: "For companies booking venues, catering and experiences for their teams." },
  venue: { title: "List your venue", description: "For restaurants, bars, banquet halls and other venues that host corporate events." },
  partner: { title: "Offer your services", description: "For artists, experience studios, caterers and other event suppliers." },
};

/**
 * Two doors: hosting events, or listing a business. A business then says what
 * it offers (a venue, or services), which picks the venue or partner account.
 */
const DOORS = [
  { label: "Hosting events", href: "/signup?type=enterprise", types: ["enterprise"] },
  { label: "List your business", href: "/signup?type=venue", types: ["venue", "partner"] },
] as const satisfies readonly { label: string; href: string; types: readonly AccountType[] }[];

const OFFERS: { type: AccountType; label: string; hint: string }[] = [
  { type: "venue", label: "A venue", hint: "Restaurants, bars, banquet halls" },
  { type: "partner", label: "Services", hint: "Catering, artists, experiences" },
];

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
      <nav aria-label="Account type" className="border-line grid grid-cols-2 gap-1 rounded-md border p-1">
        {DOORS.map((door) => {
          const current = (door.types as readonly AccountType[]).includes(accountType);
          return (
            <Link
              key={door.label}
              href={door.href}
              aria-current={current ? "page" : undefined}
              className={cn("flex min-h-10 items-center justify-center rounded text-meta", current ? "bg-surface-raised text-fg font-medium" : "text-fg-subtle hover:text-fg")}
            >
              {door.label}
            </Link>
          );
        })}
      </nav>
      <Card>
        <CardHeader>
          {accountType !== "enterprise" ? (
            <nav aria-label="What do you offer?" className="mb-2 grid gap-2">
              <p className="text-fg text-body font-medium">What do you offer?</p>
              <div className="grid grid-cols-2 gap-2">
                {OFFERS.map((o) => (
                  <Link
                    key={o.type}
                    href={`/signup?type=${o.type}`}
                    aria-current={accountType === o.type ? "page" : undefined}
                    className={cn(
                      "grid min-h-14 content-center gap-0.5 rounded-md border px-3 py-2",
                      accountType === o.type ? "border-fg bg-surface-raised" : "border-line hover:border-fg-subtle"
                    )}
                  >
                    <span className="text-fg text-meta font-medium">{o.label}</span>
                    <span className="text-fg-subtle text-meta">{o.hint}</span>
                  </Link>
                ))}
              </div>
            </nav>
          ) : null}
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
