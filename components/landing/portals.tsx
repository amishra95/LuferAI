import Link from "next/link";
import { ArrowRight, Building2, ConciergeBell, ShieldCheck, type LucideIcon } from "lucide-react";

import { IconTile, type Accent } from "@/components/landing/icon-tile";

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
    accent: "plum",
    title: "Property portal",
    audience: "Hotel & restaurant managers",
    body: "Review incoming requests, approve or decline, and follow monthly payouts.",
  },
  {
    href: "/admin",
    icon: ShieldCheck,
    accent: "coral",
    title: "Admin portal",
    audience: "Platform operations",
    body: "Bookings, gross booking value, commission earned and the venue onboarding queue.",
  },
] satisfies { href: string; icon: LucideIcon; accent: Accent; title: string; audience: string; body: string }[];

export function Portals() {
  return (
    <section id="portals" aria-labelledby="portals-title" className="section-block container-public scroll-mt-8">
      <header className="max-w-2xl">
        <p className="text-coral-ink text-xs font-semibold tracking-[0.2em] uppercase">Portals</p>
        <h2 id="portals-title" className="font-display text-plum mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          One platform, three sides of the booking
        </h2>
      </header>

      <ul className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        {PORTALS.map(({ href, icon, accent, title, audience, body }) => (
          <li key={href}>
            <Link href={href} className="landing-card group flex h-full flex-col p-8 focus-visible:outline-none">
              <IconTile icon={icon} accent={accent} />
              <h3 className="font-display text-plum mt-6 text-xl flex items-center gap-1.5 font-semibold">
                {title}
                <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
              </h3>
              <p className="text-ink-muted mt-1 text-meta">{audience}</p>
              <p className="text-plum/80 mt-4 text-body">{body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
