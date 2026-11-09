import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { BillSheet } from "@/components/landing/bill-sheet";

const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#finance", label: "Finance" },
  { href: "#venues", label: "Venues" },
  { href: "#faq", label: "FAQ" },
];

// The bill book's carbon cover: white wordmark, the yellow copy as the one filled action.
export function SiteHeader() {
  return (
    <header className="on-plum landing-header sticky top-0 z-40 pt-[var(--app-safe-top)]">
      <div className="container-public flex items-center justify-between gap-4 py-3">
        <Link href="/" aria-label="Lufer home" className="rounded-md">
          <Logo size="sm" tagline={false} tone="linen" />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-meta font-medium">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-on-carbon-muted hover:text-white hidden rounded-md px-3 py-2 lg:inline-flex">
              {n.label}
            </Link>
          ))}
          <Link href="/login" className="text-on-carbon-muted hover:text-white rounded-md px-3 py-2">
            Sign in
          </Link>
          <Link href="/signup" className="landing-btn landing-btn-ghost landing-btn-sm">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="on-plum relative overflow-hidden">
      <div className="container-public grid items-center gap-14 pt-12 pb-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pt-20 lg:pb-24">
        <div>
          <h1 id="hero-title" className="font-display font-wide text-[2.4rem] leading-[1] font-bold tracking-tight text-balance text-white sm:text-[3.4rem] xl:text-[3.9rem]">
            Team offsites, client dinners and events, booked in minutes.
          </h1>

          <p className="text-on-carbon-muted mt-7 max-w-xl text-lg text-pretty sm:text-xl">
            Bengaluru venues that fit your policy, quotes direct from them, approvals before any spend and a GST invoice for every booking.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="landing-btn landing-btn-primary w-full sm:w-auto">
              Plan your first event <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/signup?type=venue" className="landing-btn landing-btn-ghost w-full sm:w-auto">
              List your venue
            </Link>
          </div>
        </div>

        <BillSheet />
      </div>
    </section>
  );
}
