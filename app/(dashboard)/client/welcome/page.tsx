import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, CalendarPlus, MessageSquare, ShieldCheck } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
          { icon: CalendarPlus, title: "Plan your first event", href: "/client" },
          { icon: Building2, title: "Browse venues", href: "/client#venues-heading" },
        ]
      : []),
    { icon: ShieldCheck, title: member.corporateRole === "APPROVER" ? "Set approvals and budgets" : "See approvals and budgets", href: "/governance" },
    { icon: MessageSquare, title: "Ask the concierge", href: "/chat" },
  ];

  return (
    <PortalShell portal="/client" title={first ? `Welcome to Lufer, ${first}` : "Welcome to Lufer"}>
      <div className="grid max-w-3xl gap-6">
        <ul className="grid gap-3 sm:grid-cols-2">
          {steps.map(({ icon: Icon, title, href }) => (
            <li key={title}>
              <Link href={href} className="group block h-full">
                <Card className="group-hover:border-line-strong h-full transition-colors">
                  <CardHeader>
                    <Icon className="text-primary size-5" aria-hidden />
                    <CardTitle className="flex items-center gap-1">
                      {title}
                      <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </CardTitle>
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
