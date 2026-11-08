import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { currentApplication, requirePortal } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Welcome" };

/**
 * A company's first page after signing up (/auth/callback sends them here):
 * one thing to do first, find a venue and ask for a quote. Finance viewers,
 * who can't request, go to the dashboard. Admins and anyone without a
 * company: the portal.
 */
export default async function ClientWelcomePage() {
  const member = await requirePortal("/client");
  if (!member.companyId) redirect("/client");
  const application = await currentApplication();
  const first = application?.full_name.split(" ")[0];
  const canRequest = member.corporateRole === "ORGANIZER" || member.corporateRole === "APPROVER";

  return (
    <PortalShell portal="/client" title={first ? `Welcome to Lufer, ${first}` : "Welcome to Lufer"}>
      <div className="grid max-w-xl justify-items-start gap-4">
        {canRequest ? (
          <Link href="/venues" className="btn btn-primary">
            Browse venues <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
        <Link href="/client" className="text-link inline-flex items-center gap-1 text-body underline-offset-2 hover:underline">
          Go to your dashboard <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </PortalShell>
  );
}
