import Link from "next/link";
import { ArrowRight, Building2, ConciergeBell, ShieldCheck, type LucideIcon } from "lucide-react";

import { IconTile } from "@/components/landing/icon-tile";

const PORTALS = [
  {
    href: "/client",
    icon: Building2,
    accent: "coral",
    title: "Client portal",
    audience: "Corporate admins & EAs",
    body: "Request events, track bookings and see the GST input tax credit your team reclaims.",
  },
  {
    href: "/property",
    icon: ConciergeBell,
    accent: "mint",
    title: "Property portal",
    audience: "Hotel & restaurant managers",
    body: "Review incoming requests, approve or decline, and follow monthly payouts.",
  },
  {
    href: "/admin",
    icon: ShieldCheck,
    accent: "gold",
    title: "Admin portal",
    audience: "Platform operations",
    body: "Bookings, gross booking value, commission earned and the venue onboarding queue.",
  },
] satisfies { href: string; icon: LucideIcon; accent: "coral" | "mint" | "gold"; title: string; audience: string; body: string }[];

export function Portals() {
  return (
    <section id="portals" aria-labelledby="portals-title" className="section-block container-public scroll-mt-8">
      <header className="max-w-2xl">
        <p className="text-gold text-meta font-semibold">Portals</p>
        <h2 id="portals-title" className="font-display text-fg mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          One platform, three sides of the booking
        </h2>
      </header>

      <ul className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        {PORTALS.map(({ href, icon, accent, title, audience, body }) => (
          <li key={href}>
            <Link href={href} className="landing-card group flex h-full flex-col p-6 focus-visible:outline-none">
              <IconTile icon={icon} accent={accent} />
              <h3 className="text-card-title text-fg mt-5 flex items-center gap-1.5 font-semibold">
                {title}
                <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
              </h3>
              <p className="text-fg-subtle mt-1 text-meta">{audience}</p>
              <p className="text-fg-subtle mt-4 text-body">{body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
