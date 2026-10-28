import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, DoorClosed, FlaskConical, ShieldAlert, ShieldX, Users } from "lucide-react";

import { SiteHeader } from "@/components/landing/hero";
import { SiteFooter } from "@/components/landing/sections";
import { seedDb } from "@/lib/data/mock-store";
import { calculateGst, stateName } from "@/lib/gst-engine";
import { evaluateBookingPolicy, type BookingPolicyResult } from "@/lib/policies/evaluate-booking-policy";
import { formatDate, formatINR } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Sample workspace",
  description: "See how Lufer books corporate events: venue search, spend policy checks, GST invoices with input tax credit, and what finance sees. Sample data, no account needed.",
};

const shortName = (legal: string) => legal.replace(/ Private Limited$/, "");

/** Three requests against the sample company's policy: in policy, a manager's sign-off, and the CFO's too. */
const REQUESTS = [
  { title: "Team lunch", guests: 18, perHead: 1400, alcohol: false, date: "2026-11-12", type: "team_meal" as const },
  { title: "Quarter-end dinner with drinks", guests: 30, perHead: 2600, alcohol: true, date: "2026-11-19", type: "celebration" as const },
  { title: "Leadership offsite dinner", guests: 40, perHead: 3800, alcohol: false, date: "2026-11-27", type: "offsite" as const },
];

function Outcome({ result }: { result: BookingPolicyResult }) {
  if (result.blocked) {
    return (
      <p className="text-rose inline-flex items-start gap-1.5 text-meta font-medium">
        <ShieldX className="mt-0.5 size-4 shrink-0" aria-hidden /> Blocked: {result.reason}
      </p>
    );
  }
  if (result.requiresApproval) {
    return (
      <p className="text-gold-ink inline-flex items-start gap-1.5 text-meta font-medium">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {result.tiers === 2 ? "Manager and CFO sign-off" : "Manager sign-off"}: {result.reason}
      </p>
    );
  }
  return (
    <p className="text-sage inline-flex items-center gap-1.5 text-meta font-medium">
      <CheckCircle2 className="size-4" aria-hidden /> In policy: goes straight to the venue
    </p>
  );
}

/**
 * A public, read-only look at the product on made-up data (the in-memory seed,
 * never a real tenant): for prospects, and applicants waiting for approval.
 */
export default function DemoPage() {
  const db = seedDb();
  const company = db.companies[0];
  const policy = db.policies.find((p) => p.tenant_id === company.id) ?? null;
  const venueById = new Map(db.venues.map((v) => [v.id, v]));
  const companyById = new Map(db.companies.map((c) => [c.id, c]));
  const bookings = db.bookings
    .filter((b) => venueById.has(b.venue_id) && companyById.has(b.company_id))
    .slice(0, 6)
    .map((b) => {
      const c = companyById.get(b.company_id)!;
      const v = venueById.get(b.venue_id)!;
      return { b, c, v, invoice: calculateGst({ total_amount: Number(b.total_amount_inr), company_gstin: c.gstin, venue_gstin: v.gstin }) };
    });
  const intra = bookings.find((x) => x.invoice.gst_type === "CGST_SGST");
  const inter = bookings.find((x) => x.invoice.gst_type === "IGST");

  return (
    <>
      <SiteHeader />
      <main className="container-public grid gap-14 pt-8 pb-16">
        <section aria-labelledby="demo-title" className="grid gap-4">
          <p className="border-sand text-plum inline-flex w-fit items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-caption font-semibold">
            <FlaskConical className="size-3.5" aria-hidden /> Sample workspace · every company, venue and booking here is made up
          </p>
          <h1 id="demo-title" className="font-display text-plum text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            A look inside {shortName(company.legal_name)}&apos;s workspace
          </h1>
          <p className="text-plum/75 max-w-2xl">
            How an event goes from search to a GST invoice your finance team can claim input tax credit on: the venues employees see, the policy every request is checked against, and the
            books finance gets.
          </p>
        </section>

        <section aria-labelledby="demo-venues" className="grid gap-4">
          <h2 id="demo-venues" className="font-display text-plum text-2xl font-semibold">
            1 · Venues, with what your policy allows
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {db.venues.slice(0, 6).map((v) => (
              <li key={v.id} className="rounded-2xl border border-black/5 bg-white/80 p-5 shadow-sm">
                <p className="text-plum font-semibold">{v.name}</p>
                <p className="text-plum/60 text-caption">
                  {v.neighborhood} · {v.city}
                </p>
                <div className="text-plum/70 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta">
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden /> Up to {v.capacity_max}
                  </span>
                  {v.pdr_available ? (
                    <span className="inline-flex items-center gap-1">
                      <DoorClosed className="size-3.5" aria-hidden /> Private room
                    </span>
                  ) : null}
                  <span>Min {formatINR(Number(v.min_spend_inr))}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="demo-policy" className="grid gap-4">
          <h2 id="demo-policy" className="font-display text-plum text-2xl font-semibold">
            2 · Every request checked against policy, before anyone emails anyone
          </h2>
          {policy ? (
            <p className="text-plum/75 max-w-2xl text-meta">
              Sample policy: up to {formatINR(Number(policy.auto_approval_limit_per_head))} a head goes straight through; up to {formatINR(Number(policy.manager_approval_limit_per_head))} needs a
              manager; above {formatINR(Number(policy.max_budget_per_head))} needs the CFO as well; alcohol needs sign-off. Approvers say yes on WhatsApp or Slack.
            </p>
          ) : null}
          <ul className="grid gap-3 lg:grid-cols-3">
            {REQUESTS.map((r) => {
              const result = evaluateBookingPolicy(policy, {
                total_amount: r.guests * r.perHead,
                headcount: r.guests,
                per_head_amount: r.perHead,
                alcohol_included: r.alcohol,
                event_date: r.date,
                event_type: r.type,
              });
              return (
                <li key={r.title} className="grid gap-2 rounded-2xl border border-black/5 bg-white/80 p-5 shadow-sm">
                  <p className="text-plum font-semibold">{r.title}</p>
                  <p className="text-plum/60 text-caption">
                    {formatDate(r.date)} · {r.guests} guests × {formatINR(r.perHead)}
                    {r.alcohol ? " · with drinks" : ""}
                  </p>
                  <Outcome result={result} />
                </li>
              );
            })}
          </ul>
        </section>

        {intra || inter ? (
          <section aria-labelledby="demo-gst" className="grid gap-4">
            <h2 id="demo-gst" className="font-display text-plum text-2xl font-semibold">
              3 · A GST invoice for every booking, under SAC 998596
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {[intra, inter].filter((x): x is NonNullable<typeof x> => Boolean(x)).map(({ b, c, v, invoice }) => (
                <div key={b.id} className="rounded-2xl border border-black/5 bg-white/80 p-5 shadow-sm">
                  <p className="text-plum font-semibold">
                    {shortName(c.legal_name)} → {v.name}
                  </p>
                  <p className="text-plum/60 text-caption">
                    {stateName(c.gstin.slice(0, 2))} company, {stateName(v.gstin.slice(0, 2))} venue · {invoice.gst_type === "IGST" ? "inter-state: IGST" : "intra-state: CGST + SGST"}
                  </p>
                  <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-meta">
                    <dt className="text-plum/70">Taxable value</dt>
                    <dd className="text-plum text-right tabular-nums">{formatINR(invoice.taxable_value)}</dd>
                    {invoice.gst_type === "IGST" ? (
                      <>
                        <dt className="text-plum/70">IGST 18%</dt>
                        <dd className="text-plum text-right tabular-nums">{formatINR(invoice.tax_breakup.igst.amount)}</dd>
                      </>
                    ) : (
                      <>
                        <dt className="text-plum/70">CGST 9%</dt>
                        <dd className="text-plum text-right tabular-nums">{formatINR(invoice.tax_breakup.cgst.amount)}</dd>
                        <dt className="text-plum/70">SGST 9%</dt>
                        <dd className="text-plum text-right tabular-nums">{formatINR(invoice.tax_breakup.sgst.amount)}</dd>
                      </>
                    )}
                    <dt className="text-plum font-semibold">Invoice total</dt>
                    <dd className="text-plum text-right font-semibold tabular-nums">{formatINR(invoice.invoice_total)}</dd>
                  </dl>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="demo-finance" className="grid gap-4">
          <h2 id="demo-finance" className="font-display text-plum text-2xl font-semibold">
            4 · What finance sees
          </h2>
          <p className="text-plum/75 max-w-2xl text-meta">Every booking with its tax, ready to export to Tally Prime, Zoho Books or ERPNext.</p>
          <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white/80 shadow-sm">
            <table className="w-full min-w-[40rem] text-meta">
              <thead>
                <tr className="text-plum/60 border-b border-black/5 text-left">
                  <th scope="col" className="px-4 py-3 font-medium">Event</th>
                  <th scope="col" className="px-4 py-3 font-medium">Company</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Taxable</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">GST</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(({ b, c, v, invoice }) => (
                  <tr key={b.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-plum font-medium">{v.name}</div>
                      <div className="text-plum/60 text-caption">
                        {formatDate(b.event_date)} · {b.party_size} guests
                      </div>
                    </td>
                    <td className="text-plum/75 px-4 py-3">{shortName(c.legal_name)}</td>
                    <td className="text-plum px-4 py-3 text-right tabular-nums">{formatINR(invoice.taxable_value)}</td>
                    <td className="text-plum px-4 py-3 text-right tabular-nums">{formatINR(invoice.total_tax)}</td>
                    <td className="text-plum px-4 py-3 text-right font-semibold tabular-nums">{formatINR(invoice.invoice_total)}</td>
                    <td className="text-plum/75 px-4 py-3">{b.status === "PENDING_APPROVAL" ? "Awaiting sign-off" : b.status.charAt(0) + b.status.slice(1).toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <Link href="/signup" className="landing-btn landing-btn-primary">
            Set this up for your company <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href="/login" className="text-plum/75 hover:text-plum text-meta font-medium">
            Already approved? Sign in
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
