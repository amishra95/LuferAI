import { Hero, SiteHeader } from "@/components/landing/hero";
import { Audiences, Comparison, Faq, FinalCta, ForVenues, IndiaBand, SiteFooter, Workflow } from "@/components/landing/sections";

// Editorial linen landing: light in every OS theme (see .landing in globals.css).
// Server-rendered markup only (no client components), so it ships no page JS.
export default function Home() {
  return (
    <div className="landing flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Hero />
        <IndiaBand />
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
