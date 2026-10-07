import Link from "next/link";
import { ArrowRight, Building2, ConciergeBell, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const portals = [
  {
    href: "/client",
    icon: Building2,
    title: "Client Portal",
    audience: "Corporate admins & EAs",
    body: "Request events, track bookings and see the GST input tax credit your team reclaims.",
  },
  {
    href: "/property",
    icon: ConciergeBell,
    title: "Property Portal",
    audience: "Hotel & restaurant managers",
    body: "Review incoming requests, approve or decline, and follow monthly payouts.",
  },
  {
    href: "/admin",
    icon: ShieldCheck,
    title: "Admin Portal",
    audience: "Platform operations",
    body: "Bookings, gross booking value, commission earned and the venue onboarding queue.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <p className="label-mono">CorpHospitality · India</p>
      <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
        GST-compliant corporate hospitality, from request to invoice.
      </h1>
      <p className="text-muted-foreground mt-3 max-w-2xl">
        Every booking is invoiced under SAC 998596 with CGST + SGST or IGST worked out from the
        two parties&apos; GSTINs.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {portals.map(({ href, icon: Icon, title, audience, body }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardHeader>
                <Icon className="text-fg-subtle mb-2 size-5" strokeWidth={1.75} aria-hidden />
                <CardTitle className="flex items-center gap-1">
                  {title}
                  <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </CardTitle>
                <CardDescription>{audience}</CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">{body}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
