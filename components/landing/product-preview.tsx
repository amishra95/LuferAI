import { BadgeCheck, Clock, MapPin, Sparkles, Users } from "lucide-react";

/*
 * Hero visual: a static, illustrative rendering of the concierge flow (brief →
 * matched venues with card signals → GST split). Venues are the demo-store
 * names; the arithmetic is real: 40 × ₹2,450 = ₹98,000, CGST + SGST at 9% each.
 * Pure markup, no client JS, so the landing stays fully static.
 */

const VENUES = [
  { name: "The Copper Courtyard", area: "Indiranagar", km: "2.1 km from office", perHead: "₹2,450", tags: ["In policy", "Booked by 6 coworkers"], top: true },
  { name: "Saffron Terrace", area: "Koramangala", km: "4.8 km from office", perHead: "₹2,200", tags: ["In policy", "Confirms within 3 h"] },
  { name: "Indigo House", area: "Lavelle Road", km: "6.3 km from office", perHead: "₹3,100", tags: ["Needs approval"], warn: true },
];

export function ProductPreview() {
  return (
    <div aria-hidden className="landing-preview relative mx-auto w-full max-w-xl select-none lg:mx-0 lg:justify-self-end">
      <div className="landing-glow" />

      <div className="border-sand relative rounded-[1.25rem] border bg-white/90 p-4 shadow-[0_24px_60px_-20px_rgb(42_27_61/0.35)] backdrop-blur sm:p-5">
        {/* Brief */}
        <div className="flex items-start gap-3">
          <span className="bg-plum text-linen grid size-8 shrink-0 place-items-center rounded-full text-caption font-semibold">PS</span>
          <p className="bg-linen text-plum rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-meta">
            Team dinner for 40 in Bengaluru next Friday, private room, under ₹2,500 a head.
          </p>
        </div>

        <div className="mt-4 flex items-center gap-2 text-caption font-semibold text-coral-ink">
          <Sparkles className="size-3.5" />
          3 venues matched · checked against Engineering policy
        </div>

        <ul className="mt-3 space-y-2">
          {VENUES.map((v) => (
            <li key={v.name} className={`rounded-xl border p-3 ${v.top ? "border-coral/40 bg-coral-soft/50" : "border-sand bg-white"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-plum truncate text-meta font-semibold">
                    {v.name}
                    {v.top ? <span className="bg-gold-soft text-gold-ink ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Top pick</span> : null}
                  </p>
                  <p className="text-ink-muted mt-0.5 flex items-center gap-1 text-caption">
                    <MapPin className="size-3" /> {v.area} · {v.km}
                  </p>
                </div>
                <p className="text-plum shrink-0 text-meta font-semibold tabular-nums">
                  {v.perHead}
                  <span className="text-ink-muted font-normal">/head</span>
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {v.tags.map((t) => (
                  <span
                    key={t}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      t === "In policy" ? "bg-mint-soft text-mint-ink" : v.warn ? "bg-gold-soft text-gold-ink" : "bg-plum/[0.06] text-plum"
                    }`}
                  >
                    {t === "In policy" ? <BadgeCheck className="size-3" /> : t.startsWith("Confirms") ? <Clock className="size-3" /> : t.startsWith("Booked") ? <Users className="size-3" /> : null}
                    {t}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Floating GST card */}
      <div className="border-sand landing-float relative -mt-6 ml-auto w-[78%] rounded-2xl border bg-white p-4 shadow-[0_18px_40px_-18px_rgb(42_27_61/0.4)] sm:-mt-10 sm:w-64 lg:absolute lg:-right-6 lg:-bottom-10 lg:mt-0">
        <p className="text-ink-muted text-[11px] font-semibold tracking-[0.14em] uppercase">Tax invoice · SAC 998596</p>
        <dl className="text-plum mt-2 space-y-1 text-caption tabular-nums">
          <div className="flex justify-between"><dt className="text-ink-muted">Taxable value</dt><dd>₹98,000</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">CGST 9%</dt><dd>₹8,820</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">SGST 9%</dt><dd>₹8,820</dd></div>
          <div className="border-sand flex justify-between border-t pt-1 font-semibold"><dt>Total</dt><dd>₹1,15,640</dd></div>
        </dl>
        <p className="bg-mint-soft text-mint-ink mt-2 rounded-lg px-2 py-1 text-[11px] font-semibold">₹17,640 ITC claimable</p>
      </div>

      {/* Floating approval chip */}
      <div className="border-sand landing-float-delayed absolute -top-5 -left-3 hidden items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-caption font-medium shadow-[0_12px_30px_-14px_rgb(42_27_61/0.45)] sm:flex">
        <span className="bg-mint grid size-5 place-items-center rounded-full text-[10px] text-white">✓</span>
        <span className="text-plum">Approved on WhatsApp by Rohan</span>
      </div>
    </div>
  );
}
