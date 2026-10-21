import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Portals } from "@/components/landing/portals";

// The whole landing sits on one full-bleed plum surface; .on-plum remaps the tokens.
export default function Home() {
  return (
    <main className="landing on-plum flex flex-1 flex-col pb-[calc(3rem+var(--app-safe-bottom))]">
      <Hero />
      <Portals />
      <HowItWorks />
    </main>
  );
}
