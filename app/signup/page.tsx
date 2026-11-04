import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { homeFor } from "@/lib/auth/roles";
import { currentApplicationStatus, getCurrentMember } from "@/lib/auth/session";
import {
  isAccountType,
  landingFor,
  type AccountType,
} from "@/lib/auth/onboarding";
import { cn } from "@/lib/utils";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = { title: "Create an account" };

/**
 * Two doors: hosting events, or listing a business. A business then says what
 * it offers (a venue, or services), which picks the venue or partner account.
 */
const DOORS = [
  {
    label: "Hosting events",
    href: "/signup?type=enterprise",
    types: ["enterprise"],
  },
  {
    label: "List your business",
    href: "/signup?type=venue",
    types: ["venue", "partner"],
  },
] as const satisfies readonly {
  label: string;
  href: string;
  types: readonly AccountType[];
}[];

const OFFERS: { type: AccountType; label: string }[] = [
  { type: "venue", label: "A Venue" },
  { type: "partner", label: "Services" },
];

/** Public signup: companies hosting events, venue owners and suppliers. Accounts open once the email is confirmed. */
export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  // Already in: their portal. Already applied: the waiting room.
  const member = await getCurrentMember();
  if (member) redirect(homeFor(member.role));
  const applied = await currentApplicationStatus();
  if (applied) redirect(landingFor(null, applied));

  const { type } = await searchParams;
  const accountType: AccountType = isAccountType(type) ? type : "enterprise";

  return (
    <AuthShell wide>
      <nav
        aria-label="Account type"
        className="border-line grid grid-cols-2 gap-1 rounded-md border p-1"
      >
        {DOORS.map((door) => {
          const current = (door.types as readonly AccountType[]).includes(
            accountType,
          );
          return (
            <Link
              key={door.label}
              href={door.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center justify-center rounded text-meta",
                current
                  ? "bg-surface-raised text-fg font-medium"
                  : "text-fg-subtle hover:text-fg",
              )}
            >
              {door.label}
            </Link>
          );
        })}
      </nav>
      <Card>
        {/* The tabs (and, for a business, what it offers) say what this form is for: no title. */}
        {accountType !== "enterprise" ? (
          <CardHeader>
            <nav aria-label="What do you offer?" className="grid gap-2">
              <p className="text-fg text-body font-medium">
                What do you offer?
              </p>
              <div className="grid grid-cols-2 gap-2">
                {OFFERS.map((o) => (
                  <Link
                    key={o.type}
                    href={`/signup?type=${o.type}`}
                    aria-current={accountType === o.type ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center justify-center rounded-md border px-3 text-meta",
                      accountType === o.type
                        ? "border-fg bg-surface-raised text-fg font-medium"
                        : "border-line text-fg-subtle hover:border-fg-subtle hover:text-fg",
                    )}
                  >
                    {o.label}
                  </Link>
                ))}
              </div>
            </nav>
          </CardHeader>
        ) : null}
        <CardContent
          className={accountType === "enterprise" ? "pt-6" : undefined}
        >
          <SignupForm key={accountType} accountType={accountType} />
        </CardContent>
      </Card>
      <p className="text-fg-subtle text-center text-meta">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-link underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
