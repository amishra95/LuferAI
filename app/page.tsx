import Link from "next/link";
import { ArrowRight, Building2, ConciergeBell, ShieldCheck } from "lucide-react";

import { HowItWorks } from "@/components/landing/how-it-works";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const portals = [
  {
    href: "/client",
    icon: Building2,
    title: "Client portal",
    audience: "Corporate admins & EAs",
    body: "Request events, track bookings and see the GST input tax credit your team reclaims.",
  },
  {
    href: "/property",
    icon: ConciergeBell,
    title: "Property portal",
    audience: "Hotel & restaurant managers",
    body: "Review incoming requests, approve or decline, and follow monthly payouts.",
  },
  {
    href: "/admin",
    icon: ShieldCheck,
    title: "Admin portal",
    audience: "Platform operations",
    body: "Bookings, gross booking value, commission earned and the venue onboarding queue.",
  },
];

export default function Home() {
  return (
    <main className="container-public flex flex-1 flex-col justify-center pt-[calc(3rem+var(--app-safe-top))] pb-[calc(3rem+var(--app-safe-bottom))] lg:pt-[calc(5rem+var(--app-safe-top))] lg:pb-[calc(5rem+var(--app-safe-bottom))]">
      <section className="on-plum container-block px-6 py-10 sm:px-10">
        <p className="text-gold text-meta font-semibold">CorpHospitality · India</p>
        <h1 className="font-display text-hero mt-2 max-w-2xl font-semibold">GST-compliant corporate hospitality, from request to invoice.</h1>
        <p className="text-fg-subtle mt-3 max-w-2xl">
          Every booking is invoiced under SAC 998596 with CGST + SGST or IGST worked out from the
          two parties&apos; GSTINs.
        </p>
      </section>

      <section aria-label="Portals" className="section-block grid gap-6 md:grid-cols-3">
        {portals.map(({ href, icon: Icon, title, audience, body }) => (
          <Link key={href} href={href} className="group">
            <Card className="group-hover:border-line-strong h-full transition-colors">
              <CardHeader>
                <Icon className="text-fg-subtle mb-2 size-5" strokeWidth={1.75} aria-hidden />
                <CardTitle className="flex items-center gap-1">
                  {title}
                  <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </CardTitle>
                <CardDescription>{audience}</CardDescription>
              </CardHeader>
              <CardContent className="text-fg-subtle text-body">{body}</CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <HowItWorks />
    </main>
  );
}
