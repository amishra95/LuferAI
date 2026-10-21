import Link from "next/link";
import { ArrowRight, BadgeCheck, Radio, ShieldCheck, Sparkles } from "lucide-react";

/*
 * Landing hero: positioning, the two CTAs and a preview of an RFP broadcast
 * collecting direct venue bids (/api/ai/rfp-broadcast). The preview is sample
 * data, labelled as such; keep figures consistent with lib/gst-engine.ts.
 */

const BIDS = [
  { venue: "The Juniper House, Indiranagar", detail: "Private dining · 40 covers", amount: "₹2,10,000", fit: "Within policy", top: true },
  { venue: "Saffron Court", detail: "Banquet · 40 covers", amount: "₹2,34,000", fit: "Within policy", top: false },
  { venue: "Indigo Terrace", detail: "Terrace · 40 covers", amount: "₹2,72,000", fit: "Needs approval", top: false },
];

function BiddingPreview() {
  return (
    <div className="border-plum-light rounded-card mx-auto mt-14 w-full max-w-3xl overflow-hidden border bg-ink/60 text-left shadow-2xl">
      <div className="border-plum-light flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="flex gap-1.5">
            <span className="bg-plum-light size-2.5 rounded-full" />
            <span className="bg-plum-light size-2.5 rounded-full" />
            <span className="bg-plum-light size-2.5 rounded-full" />
          </span>
          <p className="text-fg-subtle ml-2 truncate text-caption">RFP-2041 · Q3 leadership dinner</p>
        </div>
        <span className="text-mint inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption font-medium">
          <Radio className="size-3.5 animate-pulse" aria-hidden /> Live bidding
        </span>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="animate-landing-rise flex gap-3">
          <span aria-hidden className="bg-plum-light text-gold grid size-8 shrink-0 place-items-center rounded-full">
            <Sparkles className="size-4" />
          </span>
          <p className="text-fg-subtle text-meta">
            <span className="text-fg font-medium">Broadcast to 12 matching venues.</span> 40 guests, Bengaluru, 14 Nov,
            ₹6,000 per head cap, private room. Policy and GST rules attached.
          </p>
        </div>

        <ul className="space-y-2" aria-label="Sample venue bids">
          {BIDS.map((b, i) => (
            <li
              key={b.venue}
              style={{ animationDelay: `${400 + i * 350}ms` }}
              className="animate-landing-rise border-plum-light bg-plum/60 flex items-center gap-3 rounded-control border px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-fg flex items-center gap-2 text-meta font-semibold">
                  {b.venue}
                  {b.top ? (
                    <span className="bg-gold/15 text-gold rounded-badge shrink-0 px-2 py-0.5 text-caption font-medium">Top pick</span>
                  ) : null}
                </p>
                <p className="text-fg-subtle text-caption">{b.detail}</p>
              </div>
              <span className={`hidden items-center gap-1 text-caption sm:inline-flex ${b.fit === "Within policy" ? "text-mint" : "text-gold"}`}>
                <ShieldCheck className="size-3.5" aria-hidden /> {b.fit}
              </span>
              <span className="figure text-fg text-meta font-semibold">{b.amount}</span>
            </li>
          ))}
        </ul>

        <div
          style={{ animationDelay: "1500ms" }}
          className="animate-landing-rise text-fg-subtle flex flex-wrap items-center justify-between gap-2 text-caption"
        >
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="text-mint size-3.5" aria-hidden /> Invoice under SAC 998596 · CGST + SGST from both GSTINs
          </span>
          <span>Sample data</span>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="landing-grid absolute inset-0 -z-10" />
      <div aria-hidden className="landing-glow absolute inset-0 -z-10" />

      <div className="container-public pt-[calc(4rem+var(--app-safe-top))] pb-16 text-center lg:pt-[calc(7rem+var(--app-safe-top))] lg:pb-24">
        <p className="border-plum-light bg-plum-light/40 text-fg-subtle rounded-badge inline-flex items-center gap-2 border px-3 py-1 text-meta">
          <span className="text-gold" aria-hidden>✦</span> Gemini-powered corporate procurement engine
        </p>

        <h1 id="hero-title" className="font-display text-fg mx-auto mt-6 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
          GST-compliant corporate hospitality.{" "}
          <span className="text-gradient-brand">From request to invoice.</span>
        </h1>

        <p className="text-fg-subtle mx-auto mt-5 max-w-2xl text-base sm:text-lg">
          Venues bid on your event directly, every request is checked against policy before a rupee is spent, and the
          GST invoice is worked out for you.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/client" className="btn btn-primary h-12 w-full px-6 text-body sm:w-auto">
            Request an event <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href="#portals" className="btn h-12 w-full px-6 text-body sm:w-auto">
            Explore portals
          </Link>
        </div>

        <BiddingPreview />
      </div>
    </section>
  );
}
