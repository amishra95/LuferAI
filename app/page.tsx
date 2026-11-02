import { Hero, SiteHeader } from "@/components/landing/hero";
import { Occasions } from "@/components/landing/occasions";
import { Audiences, Comparison, Faq, FinalCta, ForVenues, IndiaBand, SiteFooter, Workflow } from "@/components/landing/sections";

// Editorial linen landing: light in every OS theme (see .landing in globals.css).
// Server-rendered markup; the only client code is next/image for the photos (components/landing/occasions.tsx).
export default function Home() {
  return (
    <div className="landing flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Hero />
        <IndiaBand />
        <Occasions />
        <Workflow />
        <Audiences />
        <ForVenues />
        <Comparison />
        <Faq />
        <FinalCta />
      </main>
      <div className="pb-[var(--app-safe-bottom)]">
        <SiteFooter />
      </div>
    </div>
  );
}
