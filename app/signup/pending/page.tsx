import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock, LogOut, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { landingFor } from "@/lib/auth/onboarding";
import { homeFor } from "@/lib/auth/roles";
import { currentApplication, getCurrentMember } from "@/lib/auth/session";
import { PARTNER_KIND_LABEL, type PartnerKind } from "@/lib/auth/signup-input";
import { formatDate } from "@/lib/utils";
import { signOut } from "../../login/actions";

export const metadata: Metadata = { title: "Application received" };
export const dynamic = "force-dynamic";

/**
 * The waiting room for applicants without portal access: their application
 * as submitted, and what happens next (or why it wasn't approved). Members go
 * to their portal; people who never applied, to "no access".
 */
export default async function PendingPage() {
  const member = await getCurrentMember();
  if (member) redirect(homeFor(member.role));
  const application = await currentApplication();
  if (!application) redirect(landingFor(null, null));
  // Approved, yet no role: access was removed since. Not the waiting room.
  if (application.status === "active") redirect(landingFor(null, "active"));

  const rejected = application.status === "rejected";
  const details: [string, string][] = [
    ["Account", application.account_type === "partner" ? "Partner" : "Enterprise"],
    [application.account_type === "partner" ? "Business" : "Company", application.company_name],
    ...(application.partner_role ? [["Offers", PARTNER_KIND_LABEL[application.partner_role as PartnerKind] ?? application.partner_role] as [string, string]] : []),
    ...(application.venue_website ? [["Website", application.venue_website] as [string, string]] : []),
    ...(application.gstin ? [["GSTIN", application.gstin] as [string, string]] : []),
    ["Email", application.email],
    ["Applied", formatDate(application.created_at.slice(0, 10))],
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 pt-[calc(3rem+var(--app-safe-top))] pb-[calc(3rem+var(--app-safe-bottom))]">
      <Card>
        <CardHeader>
          <div className={rejected ? "text-rose" : "text-gold-ink"} aria-hidden>
            {rejected ? <XCircle className="size-6" /> : <Clock className="size-6" />}
          </div>
          <CardTitle>{rejected ? "We couldn't approve this application" : "Application received"}</CardTitle>
          <CardDescription>
            {rejected
              ? "Your account wasn't approved. If you think that's a mistake, reply to the email you received or contact support@lufer.ai."
              : `Thanks, ${application.full_name.split(" ")[0]}. Our team reviews every account, usually within one working day. We'll email ${application.email} when you're approved, and you'll go straight to your ${application.account_type === "partner" ? "partner" : "company"} portal when you next sign in.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {rejected && application.rejection_reason ? (
            <p className="border-line rounded-md border px-3 py-2 text-body">
              <span className="text-fg-subtle block text-caption">Reason</span>
              {application.rejection_reason}
            </p>
          ) : null}
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-meta">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-subtle">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <form action={signOut}>
            <Button type="submit" variant="ghost" className="justify-self-start">
              <LogOut className="size-4" aria-hidden /> Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
