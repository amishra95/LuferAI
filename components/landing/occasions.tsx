import Image from "next/image";
import { Check } from "lucide-react";

/*
 * Landing photography. Self-hosted in public/landing (CSP-friendly, optimised
 * by next/image). All under the Unsplash License (free for commercial use, no
 * attribution required):
 *   client-dinner.jpg     SO Creative     unsplash.com/photos/JWUKBFHzyh0 (cropped)
 *   team-celebration.jpg                  unsplash.com/photos/7BpuzmcxlHU
 *   offsite-banquet.jpg   Matt Benson     unsplash.com/photos/cQxEJoQZ_-E
 *   rooftop-evening.jpg   Ryan Liu        unsplash.com/photos/FrLPeW1urbQ
 *   catering-thali.jpg    fuseviews       unsplash.com/photos/bKmSUcAGrvI
 */

/** Hero right column: a venue photo with two small cards from the product over it. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-xl min-w-0 lg:mx-0 lg:max-w-none lg:justify-self-end">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] shadow-[0_30px_70px_-30px_rgb(42_27_61/0.55)] lg:aspect-square">
        <Image
          src="/landing/client-dinner.jpg"
          alt="A restaurant set for dinner: burgundy chairs around marble tables with dishes laid out"
          fill
          preload
          sizes="(min-width: 1024px) 40vw, (min-width: 640px) 36rem, 100vw"
          className="object-cover"
        />
      </div>

      {/* Illustrative: the same booking as the "How it works" preview (40 × ₹2,450, GST at 18%). */}
      <div aria-hidden className="border-sand absolute top-4 left-4 inline-flex items-center gap-2 rounded-full border bg-white/95 px-3 py-1.5 text-caption font-medium text-plum shadow-lg sm:top-6 sm:left-6 lg:top-10 lg:-left-8">
        <Check className="bg-mint-soft text-mint-ink size-4 rounded-full p-0.5" strokeWidth={3} />
        Approved on WhatsApp by Rohan
      </div>

      <div aria-hidden className="border-sand relative mx-3 -mt-14 rounded-2xl border bg-white/95 p-4 shadow-[0_24px_60px_-20px_rgb(42_27_61/0.45)] backdrop-blur sm:mx-6 sm:-mt-16 lg:absolute lg:right-auto lg:bottom-8 lg:-left-10 lg:mx-0 lg:mt-0 lg:w-80">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-plum truncate text-meta font-semibold">The Copper Courtyard</p>
            <p className="text-ink-muted text-caption">Indiranagar · 40 guests · Fri, 8 pm</p>
          </div>
          <span className="bg-mint-soft text-mint-ink shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold">Confirmed</span>
        </div>
        <div className="border-sand mt-3 flex items-center justify-between border-t pt-3 text-caption">
          <span className="text-ink-muted">₹98,000 + GST</span>
          <span className="text-mint-ink font-semibold">₹17,640 ITC claimable</span>
        </div>
      </div>
    </div>
  );
}

const OCCASIONS = [
  {
    src: "/landing/team-celebration.jpg",
    alt: "Colleagues raising glasses of wine over a candlelit dinner table",
    title: "Team celebrations",
    body: "Quarter-end dinners, Diwali parties and farewells.",
    className: "sm:col-span-2 lg:col-span-2",
    position: "object-[center_30%]",
  },
  {
    src: "/landing/rooftop-evening.jpg",
    alt: "A rooftop bar at night lit in pink and blue with high tables",
    title: "Evenings out",
    body: "Rooftops, bars and private lounges.",
    className: "lg:row-span-2",
    position: "object-[center_75%]",
  },
  {
    src: "/landing/offsite-banquet.jpg",
    alt: "A banquet hall with round tables, gold chairs and chandeliers",
    title: "Offsites and conferences",
    body: "Banquet halls and resorts for 50 to 500.",
    className: "",
    position: "object-center",
  },
  {
    src: "/landing/catering-thali.jpg",
    alt: "A steel thali with sabzi, rotis, a sweet and buttermilk",
    title: "Catering",
    body: "Working lunches and office events.",
    className: "",
    position: "object-center",
  },
];

/** "Every kind of occasion": photo cards for what companies book. */
export function Occasions() {
  return (
    <section aria-labelledby="occasions-title" className="section-block container-public">
      <div className="mx-auto max-w-2xl text-center">
        <h2 id="occasions-title" className="font-display text-plum text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          The places your team will remember
        </h2>
        <p className="text-ink-muted mt-4 text-base text-pretty">
          From a client dinner for six to an offsite for three hundred, at venues that fit your policy and quote you directly.
        </p>
      </div>

      <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:auto-rows-[17rem] lg:grid-cols-3">
        {OCCASIONS.map((o) => (
          <li key={o.title} className={`group relative aspect-[4/3] overflow-hidden rounded-2xl lg:aspect-auto ${o.className}`}>
            <Image
              src={o.src}
              alt={o.alt}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className={`object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${o.position}`}
            />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[rgb(26_21_35/0.82)] via-[rgb(26_21_35/0.15)] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <h3 className="font-display text-linen text-xl font-semibold">{o.title}</h3>
              <p className="text-linen/85 mt-1 text-meta">{o.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
