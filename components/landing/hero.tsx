import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { ProductPreview } from "@/components/landing/product-preview";

const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#finance", label: "For finance" },
  { href: "#venues", label: "For venues" },
  { href: "#faq", label: "FAQ" },
];

// Sticky, blurred over linen; the coral CTA is the one primary action on every screen.
export function SiteHeader() {
  return (
    <header className="landing-header sticky top-0 z-40 pt-[var(--app-safe-top)]">
      <div className="container-public flex items-center justify-between gap-4 py-3">
        <Link href="/" aria-label="Lufer.ai home" className="rounded-md">
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

const PROOF = ["GST invoices under SAC 998596", "Approvals on WhatsApp & Slack", "Exports to Tally Prime & Zoho"];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="landing-hero relative overflow-hidden">
      <div className="container-public grid items-center gap-12 pt-12 pb-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pt-20 lg:pb-24">
        <div className="text-center lg:text-left">
          <p className="border-sand text-plum inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-caption font-semibold">
            <span aria-hidden className="status-dot bg-mint" />
            Built for Indian companies, GST and all
          </p>

          <h1 id="hero-title" className="font-display text-plum mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.6rem] lg:leading-[1.05]">
            Team offsites, client dinners and events, <span className="landing-underline">booked in minutes</span>.
          </h1>

          <p className="text-ink-muted mx-auto mt-6 max-w-xl text-base text-pretty sm:text-lg lg:mx-0">
            Describe the event once. Lufer finds venues that fit your policy, gets quotes directly from them, routes
            approvals to WhatsApp, and hands finance a GST-correct invoice with input tax credit tracked.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link href="/signup" className="landing-btn landing-btn-primary w-full sm:w-auto">
              Plan your first event <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/signup?type=partner" className="landing-btn landing-btn-outline w-full sm:w-auto">
              List your venue
            </Link>
          </div>

          <ul className="text-plum/80 mt-8 flex flex-col items-center gap-x-5 gap-y-2 text-meta sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start" aria-label="Highlights">
            {PROOF.map((p) => (
              <li key={p} className="inline-flex items-center gap-1.5">
                <Check className="text-mint-ink size-4" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>

        <ProductPreview />
      </div>
    </section>
  );
}
