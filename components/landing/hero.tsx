import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/brand/logo";

export function SiteHeader() {
  return (
    <header className="border-sand border-b pt-[var(--app-safe-top)]">
      <div className="container-public flex items-center justify-between py-4">
        <Link href="/" aria-label="Lufer.ai home" className="rounded-md">
          <Logo size="sm" tagline={false} />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-meta font-medium">
          <Link href="#portals" className="text-plum/80 hover:text-plum hidden rounded-full px-3 py-2 sm:inline-flex">
            Portals
          </Link>
          <Link href="#how-it-works" className="text-plum/80 hover:text-plum hidden rounded-full px-3 py-2 sm:inline-flex">
            How it works
          </Link>
          <Link href="/login" className="text-plum hover:bg-plum/5 border-plum/20 rounded-full border px-4 py-2">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-public pt-14 pb-16 text-center lg:pt-20 lg:pb-24">
      <Logo size="lg" />

      <h1 id="hero-title" className="font-display text-plum mx-auto mt-12 max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
        GST-compliant corporate hospitality &amp; team outings, from request to invoice.
      </h1>

      <p className="text-ink-muted mx-auto mt-6 max-w-2xl text-base text-balance sm:text-lg">
        LuferAI takes the middleman out of corporate venue sourcing, automates pre-spend governance, and coordinates
        procurement from one request.
      </p>

      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/client" className="landing-btn landing-btn-primary w-full sm:w-auto">
          Request an event <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link href="#portals" className="landing-btn landing-btn-outline w-full sm:w-auto">
          Explore portals
        </Link>
      </div>
    </section>
  );
}
