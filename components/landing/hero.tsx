import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { HeroVisual } from "@/components/landing/occasions";

const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#finance", label: "Finance" },
  { href: "#venues", label: "Venues" },
  { href: "#faq", label: "FAQ" },
];

// Sticky, blurred over linen; the green CTA is the one filled action on every screen.
export function SiteHeader() {
  return (
    <header className="landing-header sticky top-0 z-40 pt-[var(--app-safe-top)]">
      <div className="container-public flex items-center justify-between gap-4 py-3">
        <Link href="/" aria-label="Lufer home" className="rounded-md">
          <Logo size="sm" tagline={false} />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-meta font-medium">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-plum/75 hover:text-plum hidden rounded-full px-3 py-2 lg:inline-flex">
              {n.label}
            </Link>
          ))}
          <Link href="/login" className="text-plum/75 hover:text-plum rounded-full px-3 py-2">
            Sign in
          </Link>
          <Link href="/signup" className="landing-btn landing-btn-primary landing-btn-sm">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="landing-hero relative overflow-hidden">
      <div className="container-public grid items-center gap-12 pt-12 pb-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pt-20 lg:pb-12">
        <div className="text-center lg:text-left">
          <h1 id="hero-title" className="font-display text-plum text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.6rem] lg:leading-[1.05]">
            Team offsites, client dinners and events, <span className="landing-underline">booked in minutes</span>.
          </h1>

          <p className="text-ink-muted mx-auto mt-6 max-w-xl text-base text-pretty sm:text-lg lg:mx-0">
            Bengaluru venues that fit your policy, quotes direct from them, approvals before any spend and a GST invoice for every booking.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/signup" className="landing-btn landing-btn-primary w-full sm:w-auto">
              Plan your first event <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/signup?type=venue" className="landing-btn landing-btn-outline w-full sm:w-auto">
              List your venue
            </Link>
          </div>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}
