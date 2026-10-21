import { Hero, SiteHeader } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Portals } from "@/components/landing/portals";

// Editorial linen landing: light in every OS theme (see .landing in globals.css).
export default function Home() {
  return (
    <div className="landing flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col pb-[calc(3rem+var(--app-safe-bottom))]">
        <Hero />
        <Portals />
        <HowItWorks />
      </main>
    </div>
  );
}
