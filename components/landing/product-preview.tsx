import { MapPin } from "lucide-react";

/*
 * "How it works" visual: a static, illustrative rendering of the concierge flow
 * (brief → matched venues, each with the same band of facts → the GST split on
 * a pink duplicate slip). Venues are the demo-store names; the arithmetic is
 * real: 40 × ₹2,450 = ₹98,000, CGST + SGST at 9% each. Pure markup, no client JS.
 */

const VENUES = [
  { name: "The Copper Courtyard", area: "Indiranagar", km: "2.1 km", perHead: "₹2,450", stamp: "In policy", note: "Booked by 6 coworkers", top: true },
  { name: "Saffron Terrace", area: "Koramangala", km: "4.8 km", perHead: "₹2,200", stamp: "In policy", note: "Confirms within 3 h" },
  { name: "Indigo House", area: "Lavelle Road", km: "6.3 km", perHead: "₹3,100", stamp: "Needs approval" },
];

export function ProductPreview() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-xl select-none">
      <div className="border-ruling relative rounded-[6px] border bg-white p-4 shadow-[0_20px_44px_-24px_rgb(21_26_59/0.35)] sm:p-5">
        {/* Brief */}
        <div className="flex items-start gap-3">
          <span className="bg-carbon grid size-8 shrink-0 place-items-center rounded-[4px] text-caption font-semibold text-white">PS</span>
          <p className="bg-paper text-carbon-ink rounded-[6px] px-3.5 py-2.5 text-meta">
            Team dinner for 40 in Bengaluru next Friday, private room, under ₹2,500 a head.
          </p>
        </div>

        <p className="text-carbon border-carbon mt-4 flex justify-between gap-3 border-b-[3px] border-double pb-2 text-caption font-semibold tracking-[0.06em] uppercase">
          <span>3 venues matched · Engineering policy</span>
          <span className="text-carbon/50 text-[10px] tracking-[0.2em]">Specimen</span>
        </p>

        <ul>
          {VENUES.map((v) => (
            <li key={v.name} className={`border-ruling border-b py-3 last:border-0 ${v.top ? "bg-triplicate/50 -mx-2 px-2" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-carbon-ink text-meta font-semibold">{v.name}</p>
                  <p className="text-ink-muted mt-0.5 flex items-center gap-1 text-caption">
                    <MapPin className="size-3" /> {v.area} · {v.km} from office
                  </p>
                </div>
                <p className="font-ledger text-carbon-ink shrink-0 text-meta font-bold tabular-nums">
                  {v.perHead}
                  <span className="text-ink-muted font-normal">/head</span>
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="bill-stamp-sm text-stamp">{v.stamp}</span>
                {v.note ? <span className="text-ink-muted text-caption">{v.note}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* The pink duplicate slip with the tax split */}
      <div className="bg-duplicate text-carbon relative -mt-4 ml-auto w-[82%] rotate-[1.5deg] rounded-[4px] p-4 shadow-[0_16px_34px_-18px_rgb(21_26_59/0.45)] sm:-mt-8 sm:w-72">
        <p className="text-[11px] font-semibold tracking-[0.14em] uppercase">Tax invoice · SAC 998596</p>
        <dl className="font-ledger mt-2 space-y-1 text-caption tabular-nums">
          <div className="flex justify-between"><dt>Taxable value</dt><dd>₹98,000</dd></div>
          <div className="flex justify-between"><dt>CGST 9%</dt><dd>₹8,820</dd></div>
          <div className="flex justify-between"><dt>SGST 9%</dt><dd>₹8,820</dd></div>
          <div className="border-carbon flex justify-between border-t-[3px] border-double pt-1 font-bold"><dt>Total</dt><dd>₹1,15,640</dd></div>
        </dl>
        <p className="bill-stamp-sm text-stamp mt-3">₹17,640 ITC claimable</p>
      </div>
    </div>
  );
}
