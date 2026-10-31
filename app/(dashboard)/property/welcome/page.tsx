import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";

import { PortalShell } from "@/components/portal/portal-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { currentApplication, requirePortal } from "@/lib/auth/session";
import { getVenue } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Welcome" };

/**
 * A venue manager's first page after signing up (/auth/callback sends them
 * here): what's set up, what's left before companies see the venue, and where
 * to do each. Admins have no venue of their own: the portal.
 */
export default async function PropertyWelcomePage() {
  const member = await requirePortal("/property");
  const [venue, application] = await Promise.all([member.venueId ? getVenue(member.venueId) : null, currentApplication()]);
  if (!venue) redirect("/property");
  const first = application?.full_name.split(" ")[0];

  const pricing = "/property?tab=pricing";
  const steps: { done: boolean; title: string; body: string; href?: string }[] = [
    { done: true, title: "Create your account", body: `${venue.name}, ${venue.neighborhood}, ${venue.city}. Up to ${venue.capacity_max} guests.` },
    { done: venue.photos.length > 0, title: "Add photos", body: "Venues with photos get far more requests. Add up to 8.", href: pricing },
    {
      done: Number(venue.min_spend_inr) > 0 || Number(venue.min_spend_per_head_inr) > 0,
      title: "Set your minimum spend",
      body: "Companies only see you for events you'd accept.",
      href: pricing,
    },
    { done: Array.isArray(venue.cancellation_terms) && venue.cancellation_terms.length > 0, title: "Set cancellation terms", body: "Shown on every quote, so there are no surprises.", href: pricing },
    {
      done: venue.is_active,
      title: "Get verified",
      body: venue.is_active ? "Your venue is live: companies can find and book it." : "We check your GSTIN and address, usually within one working day. Then companies can find and book you.",
    },
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <PortalShell portal="/property" title={first ? `Welcome to Lufer, ${first}` : "Welcome to Lufer"} subtitle="Set up your venue so it's ready when companies find it.">
      <div className="grid max-w-2xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Get {venue.name} ready</CardTitle>
            <CardDescription>{left ? `${left} step${left === 1 ? "" : "s"} left.` : "All done."}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-1">
              {steps.map((s) => (
                <li key={s.title} className="flex items-start gap-3 rounded-md px-2 py-3">
                  {s.done ? <CheckCircle2 className="text-sage mt-0.5 size-5 shrink-0" aria-label="Done" /> : <Circle className="text-fg-faint mt-0.5 size-5 shrink-0" aria-label="To do" />}
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-body font-medium", s.done && "text-fg-subtle")}>{s.title}</p>
                    <p className="text-fg-subtle text-meta">{s.body}</p>
                  </div>
                  {s.href && !s.done ? (
                    <Link href={s.href} className="btn btn-secondary h-8 shrink-0 px-3 text-meta">
                      Start
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Link href="/property" className="text-link inline-flex items-center gap-1 text-body underline-offset-2 hover:underline">
          Go to your venue dashboard <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </PortalShell>
  );
}
