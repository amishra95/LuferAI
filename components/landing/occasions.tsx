import Image from "next/image";

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

const OCCASIONS = [
  {
    src: "/landing/team-celebration.jpg",
    alt: "Colleagues raising glasses of wine over a candlelit dinner table",
    title: "Team celebrations",
    body: "Quarter-end dinners, Diwali parties and farewells.",
    position: "object-[center_30%]",
  },
  {
    src: "/landing/rooftop-evening.jpg",
    alt: "A rooftop bar at night lit in pink and blue with high tables",
    title: "Evenings out",
    body: "Rooftops, bars and private lounges.",
    position: "object-[center_75%]",
  },
  {
    src: "/landing/offsite-banquet.jpg",
    alt: "A banquet hall with round tables, gold chairs and chandeliers",
    title: "Offsites and conferences",
    body: "Banquet halls and resorts for 50 to 500.",
    position: "object-center",
  },
  {
    src: "/landing/catering-thali.jpg",
    alt: "A steel thali with sabzi, rotis, a sweet and buttermilk",
    title: "Catering",
    body: "Working lunches and office events.",
    position: "object-center",
  },
];

/** "Every kind of occasion": photographs pasted into the book, each captioned as a line item. */
export function Occasions() {
  return (
    <section aria-labelledby="occasions-title" className="section-block container-public">
      <div className="max-w-2xl">
        <h2 id="occasions-title" className="font-display text-ink text-3xl font-semibold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.05]">
          The places your team will remember
        </h2>
        <p className="text-ink-muted mt-4 text-lg text-pretty">
          From a client dinner for six to an offsite for three hundred, at venues that fit your policy and quote you directly.
        </p>
      </div>

      <ul className="mt-12 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2">
        {OCCASIONS.map((o) => (
          <li key={o.title}>
            <div className="relative aspect-[3/2] overflow-hidden rounded-[6px]">
              <Image src={o.src} alt={o.alt} fill sizes="(min-width: 1152px) 34rem, (min-width: 640px) 50vw, 100vw" className={`object-cover ${o.position}`} />
            </div>
            <div className="mt-3 flex items-baseline gap-3">
              <h3 className="font-display text-ink shrink-0 text-xl font-semibold">{o.title}</h3>
              <span aria-hidden className="border-ink/30 mb-1 flex-1 border-b-2 border-dotted" />
            </div>
            <p className="text-ink-muted mt-1 text-body">{o.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
