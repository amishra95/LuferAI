import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, CalendarPlus, MessageSquare, ShieldCheck } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentApplication, requirePortal } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Welcome" };

/**
 * A company's first page after signing up (/auth/callback sends them here):
 * the few things to do first, each a link into the portal. Admins and anyone
 * without a company: the portal.
 */
export default async function ClientWelcomePage() {
  const member = await requirePortal("/client");
  if (!member.companyId) redirect("/client");
  const application = await currentApplication();
  const first = application?.full_name.split(" ")[0];
  const canRequest = member.corporateRole === "ORGANIZER" || member.corporateRole === "APPROVER";

  const steps = [
    ...(canRequest
      ? [
          { icon: CalendarPlus, title: "Plan your first event", body: "Describe it once: date, headcount, budget. Lufer finds venues that fit and gets quotes from them.", href: "/client" },
          { icon: Building2, title: "Browse venues", body: "Restaurants, rooftops and banquet halls near your office, with prices up front.", href: "/client#venues-heading" },
        ]
      : []),
    {
      icon: ShieldCheck,
      title: "Set approvals and budgets",
      body: member.corporateRole === "APPROVER" ? "Choose who signs off which amounts, and how much each team can spend." : "See who signs off your company's spend, and each team's budget.",
      href: "/governance",
    },
    { icon: MessageSquare, title: "Ask the concierge", body: "Try “Team dinner for 40 in Indiranagar next Friday, under ₹2,000 a head.”", href: "/chat" },
  ];

  return (
    <PortalShell portal="/client" title={first ? `Welcome to Lufer, ${first}` : "Welcome to Lufer"} subtitle="Your company account is ready. Here's where to start.">
      <div className="grid max-w-3xl gap-6">
        <ul className="grid gap-3 sm:grid-cols-2">
          {steps.map(({ icon: Icon, title, body, href }) => (
            <li key={title}>
              <Link href={href} className="group block h-full">
                <Card className="group-hover:border-line-strong h-full transition-colors">
                  <CardHeader>
                    <Icon className="text-primary size-5" aria-hidden />
                    <CardTitle className="flex items-center gap-1">
                      {title}
                      <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </CardTitle>
                    <CardDescription>{body}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/client" className="text-link inline-flex items-center gap-1 text-body underline-offset-2 hover:underline">
          Go to your dashboard <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </PortalShell>
  );
}
