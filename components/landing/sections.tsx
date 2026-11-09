import Link from "next/link";
import {
  ArrowRight,
  Check,
  Minus,
  Plus,
  X,
} from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { ProductPreview } from "@/components/landing/product-preview";
import { entityName } from "@/lib/legal";

/*
 * Landing sections below the hero. Every claim maps to shipped code (cited
 * inline); keep it that way when editing. No invented logos, stats or quotes:
 * add real ones to <TrustBand> as customers sign.
 */

/** A heading and, at most, one line under it. No eyebrows. */
function SectionHeader({ title, body, id, center }: { title: string; body?: string; id: string; center?: boolean }) {
  return (
    <header className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <h2 id={id} className="font-display text-carbon text-3xl font-bold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.05]">
        {title}
      </h2>
      {body ? <p className="text-ink-muted mt-4 text-lg text-pretty">{body}</p> : null}
    </header>
  );
}

/* Workflow --------------------------------------------------------------- */

const STEPS = [
  { title: "Brief", body: "Type it in plain English, or let the AI concierge turn a quick chat into a structured RFP." }, // /api/ai/generate-brief
  { title: "Compare", stamp: "In policy", body: "See matched venues with distance from your office, in-policy flags and what coworkers booked." }, // lib/venues signals, PostGIS
  { title: "Get direct quotes", body: "The RFP goes to matching venues, who quote you directly. Dates are held while you decide." }, // /api/ai/rfp-broadcast, lib/locks
  { title: "Approve", stamp: "Approved", body: "Policy is checked before any spend. Anything over a limit goes to the right approver first." }, // lib/policies, lib/approvals
  { title: "Pay", stamp: "Paid", body: "Pay the deposit online. Venues are paid out on clear terms once the event is completed." }, // /api/payments, lib/marketplace/settlement.ts
  { title: "Reconcile", body: "You get a GST tax invoice for every booking, with a Tally export for your books." }, // lib/finance
] satisfies { title: string; body: string; stamp?: string }[];

// The order is the point (policy before payment), so the steps keep their numbers.
export function Workflow() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="section-block container-public scroll-mt-20">
      <SectionHeader
        id="how-title"
        title="From “we need a venue” to a reconciled invoice"
        body="Six steps that usually take a week of emails, calls and spreadsheets, handled in one place."
      />
      <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div className="lg:order-2">
          <ProductPreview />
        </div>
        <ol className="border-ruling rounded-[6px] border bg-white px-5 sm:px-7">
          {STEPS.map(({ title, body, ...rest }, i) => (
            <li key={title} className="border-ruling grid grid-cols-[2.25rem_1fr] gap-x-3 border-b py-5 last:border-0 sm:grid-cols-[3rem_1fr]">
              <span aria-hidden className="font-ledger text-stamp pt-1 text-base font-bold tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="font-display text-carbon text-xl font-bold">{title}</h3>
                  {"stamp" in rest ? <span className="bill-stamp-sm text-stamp -rotate-3">{rest.stamp}</span> : null}
                </div>
                <p className="text-ink-muted mt-1 text-body">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* Audiences ---------------------------------------------------------------- */

type Feature = { title: string; body: string };

const ORGANISERS: Feature[] = [
  { title: "AI concierge", body: "It remembers your team's preferences and turns a quick chat into a booking." }, // lib/agent/memory.ts, channels
  { title: "Guest list & RSVPs", body: "Invite links, dietary needs, calendar invites and a shared event room." }, // lib/events
  { title: "Holds that don't vanish", body: "A countdown on every held date, released automatically if you pass." }, // components/portal/hold-countdown.tsx, cron/release-holds
];

const FINANCE: Feature[] = [
  { title: "Pre-spend policy", body: "Per-head caps, department budgets and tiered approval chains, enforced before booking." }, // lib/policies
  { title: "Spend & forecast", body: "Spend by department or cost centre, with a forecast against budget." }, // /api/analytics/forecast
  { title: "ITC governance", body: "Claim or block input tax credit per invoice, with an audit trail." }, // lib/finance/itc.ts
  { title: "Invoice OCR check", body: "Invoices are read and matched against the booking, so mismatches get flagged." }, // /api/finance/ocr-reconcile
  { title: "Tally export", body: "Tally Prime XML, plus PO ledgers per cost centre." }, // lib/finance/tally-xml.ts
  { title: "Itemised receipts", body: "Every booking itemised for your expense tool, with its cost centre." }, // lib/expense
];

/** A bill-book sheet of particulars: one numbered, ruled row per feature, marked with whose copy it is. */
function Ledger({ items, copy, className = "" }: { items: Feature[]; copy: string; className?: string }) {
  return (
    <div className={`border-ruling text-carbon-ink rounded-[6px] border bg-white shadow-[0_18px_40px_-24px_rgb(21_26_59/0.35)] ${className}`}>
      <div className="border-carbon flex items-baseline justify-between gap-4 border-b-[3px] border-double px-5 py-3 sm:px-7">
        <span className="text-carbon/70 text-[11px] font-semibold tracking-[0.12em] uppercase">Particulars</span>
        <span className="font-ledger text-carbon text-caption tracking-[0.12em] uppercase">{copy}</span>
      </div>
      <ol className="px-5 sm:px-7">
        {items.map(({ title, body }, i) => (
          <li key={title} className="border-ruling grid grid-cols-[2rem_1fr] gap-x-3 border-b py-4 last:border-0 md:grid-cols-[2.5rem_15rem_1fr] md:gap-x-6">
            <span aria-hidden className="font-ledger text-carbon/60 text-meta tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <p className="text-carbon font-semibold">{title}</p>
            <p className="text-ink-muted col-start-2 mt-1 text-body md:col-start-3 md:mt-0">{body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Audiences() {
  return (
    <>
      <section aria-labelledby="organisers-title" className="section-block container-public">
        <SectionHeader
          id="organisers-title"
          title="Plan it like you have an events team"
          body="Offsites, all-hands, client dinners, Diwali parties. Tell Lufer what you need and get options you can actually book, inside your company's rules."
        />
        <Ledger items={ORGANISERS} copy="Organiser's copy" className="mt-10" />
      </section>

      <section id="finance" aria-labelledby="finance-title" className="on-plum scroll-mt-16">
        <div className="section-block container-public">
          <header className="max-w-2xl">
            <h2 id="finance-title" className="font-display text-3xl font-bold tracking-tight text-balance text-white sm:text-[2.6rem] sm:leading-[1.05]">
              Every rupee approved before it&apos;s spent, and reconciled after
            </h2>
            <p className="text-on-carbon-muted mt-4 text-lg">
              One supplier on your books, policy checked up front, and GST you can claim.
            </p>
          </header>
          <Ledger items={FINANCE} copy="Finance copy" className="mt-12" />
        </div>
      </section>
    </>
  );
}

/* Venues (supply side) ----------------------------------------------------- */

const VENUE_FEATURES: Feature[] = [
  { title: "Corporate requests, ready to quote", body: "Party size, budget, dates and dietary needs, all in one brief." }, // property portal
  { title: "AI inquiry assistant", body: "A public inquiry page that answers questions from your venue's own facts, around the clock." }, // app/inquire/[venueId]
  { title: "Quote from your phone", body: "A link in the email opens the request. No login." }, // lib/vendor/quote-link.ts
  { title: "Book of business", body: "See every client company, when they're due to rebook, and what to offer them next." }, // property/_components/account-book.tsx
];

// The venue's copy of the bill book is the pink duplicate.
export function ForVenues() {
  return (
    <section id="venues" aria-labelledby="venues-title" className="bg-duplicate scroll-mt-20">
      <div className="section-block container-public">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeader
            id="venues-title"
            title="Win corporate business without the agency in between"
            body="Restaurants, hotels, experience studios, caterers and artists: get structured requests from companies and quote them directly."
          />
          <Link href="/signup?type=venue" className="landing-btn landing-btn-outline">
            List your venue <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <Ledger items={VENUE_FEATURES} copy="Venue's copy" className="mt-10" />
      </div>
    </section>
  );
}

/* Comparison --------------------------------------------------------------- */

type Cell = boolean | "partial" | string;
const ROWS: { label: string; lufer: Cell; agency: Cell; manual: Cell }[] = [
  { label: "Quotes direct from venues", lufer: true, agency: "Through the agency", manual: true },
  { label: "Policy checked before booking", lufer: true, agency: false, manual: false },
  { label: "GST invoice with ITC tracked", lufer: true, agency: "partial", manual: false },
  { label: "Export to Tally", lufer: true, agency: false, manual: false },
  { label: "Spend by department & cost centre", lufer: true, agency: false, manual: "Spreadsheets" },
];

function Mark({ value }: { value: Cell }) {
  if (value === true) return <Check className="text-mint-ink mx-auto size-5" aria-label="Yes" />;
  if (value === false) return <X className="text-plum/30 mx-auto size-5" aria-label="No" />;
  if (value === "partial") return <Minus className="text-gold-ink mx-auto size-5" aria-label="Partly" />;
  return <span className="text-ink-muted text-caption">{value}</span>;
}

export function Comparison() {
  return (
    <section aria-labelledby="compare-title" className="section-block container-public">
      <SectionHeader id="compare-title" title="Compared with how it's usually done" center />
      <div className="border-ruling mt-10 hidden overflow-hidden rounded-[6px] border bg-white sm:block">
        <table className="w-full text-left text-body">
          <thead>
            <tr className="border-carbon border-b-[3px] border-double">
              <th scope="col" className="text-ink-muted p-4 font-medium">
                <span className="sr-only">Capability</span>
              </th>
              <th scope="col" className="bg-accent-soft text-accent-text p-4 text-center font-bold tracking-[0.06em] uppercase">Lufer</th>
              <th scope="col" className="text-ink-muted p-4 text-center font-medium">Event agency</th>
              <th scope="col" className="text-ink-muted p-4 text-center font-medium">Email & spreadsheets</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-sand border-b last:border-0">
                <th scope="row" className="text-plum p-4 font-medium">{r.label}</th>
                <td className="bg-accent-soft/60 p-4 text-center"><Mark value={r.lufer} /></td>
                <td className="p-4 text-center"><Mark value={r.agency} /></td>
                <td className="p-4 text-center"><Mark value={r.manual} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-ruling mt-8 overflow-hidden rounded-[6px] border bg-white sm:hidden">
        <div aria-hidden className="border-carbon text-ink-muted grid grid-cols-3 border-b-[3px] border-double text-center text-caption font-medium">
          <span className="bg-accent-soft text-accent-text py-3 font-bold tracking-[0.06em] uppercase">Lufer</span>
          <span className="py-3">Event agency</span>
          <span className="py-3">Email & sheets</span>
        </div>
        <ul>
          {ROWS.map((r) => (
            <li key={r.label} className="border-sand border-b last:border-0">
              <p className="text-plum px-4 pt-4 font-medium">{r.label}</p>
              <dl className="grid grid-cols-3 text-center">
                {(
                  [
                    ["Lufer", r.lufer],
                    ["Event agency", r.agency],
                    ["Email & spreadsheets", r.manual],
                  ] as const
                ).map(([who, v], i) => (
                  <div key={who} className={`px-2 pt-2 pb-4 ${i === 0 ? "bg-accent-soft/60" : ""}`}>
                    <dt className="sr-only">{who}</dt>
                    <dd>
                      <Mark value={v} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* FAQ ------------------------------------------------------------------------ */

const FAQ = [
  {
    q: "Who is Lufer for?",
    a: "Companies in Bengaluru that book team events, offsites, client entertainment and catering, and the venues and partners who host them.",
  },
  {
    q: "How does Lufer make money?",
    a: "Venues pay Lufer a commission on completed bookings. It's split out on their settlement, and any Section 52 TCS is shown alongside it.",
  },
  {
    q: "Can we claim input tax credit?",
    a: "Yes, where the event qualifies. Every booking has a GST tax invoice under SAC 998596, with CGST + SGST or IGST worked out from both GSTINs. Finance marks each invoice claimed or blocked.",
  },
  {
    q: "How do approvals work?",
    a: "Anything over your policy goes to the right approver before it's booked. They see the itemised quote and approve or decline in Lufer.",
  },
  {
    q: "Is our data kept separate from other companies?",
    a: "Yes. Every table is isolated per company by Postgres row-level security, and concierge memory is private to the person who saved it.",
  },
  {
    q: "How do we get started?",
    a: "Create an account and confirm your email: you can start planning straight away. Venues can set up their listing straight away too, and go live once we've verified them, usually within one working day.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="section-block container-public scroll-mt-20">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeader id="faq-title" title="Questions teams ask us" />
        <div className="divide-sand border-sand divide-y border-y">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="landing-faq group py-5">
              <summary className="text-plum flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span aria-hidden className="border-ruling text-carbon grid size-7 shrink-0 place-items-center rounded-[3px] border transition-transform group-open:rotate-45">
                  <Plus className="size-4" strokeWidth={2} />
                </span>
              </summary>
              <p className="text-ink-muted mt-3 pr-10">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Closing CTA + footer ------------------------------------------------------- */

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="container-public pb-16">
      <div className="on-plum rounded-[6px] px-6 py-14 text-center sm:px-12 lg:py-20">
        <h2 id="cta-title" className="font-display font-wide mx-auto max-w-3xl text-white text-3xl font-bold tracking-tight text-balance sm:text-5xl">
          Your next offsite, without the week of emails
        </h2>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="landing-btn landing-btn-primary w-full sm:w-auto">
            Plan your first event <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href="/signup?type=venue" className="landing-btn landing-btn-ghost w-full sm:w-auto">
            I run a venue
          </Link>
        </div>
      </div>
    </section>
  );
}

// Rooted (/#…) so they also work from the legal pages, which share this footer.
const FOOTER_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#finance", label: "Finance" },
  { href: "/#venues", label: "Venues" },
  { href: "/#faq", label: "FAQ" },
  { href: "/login", label: "Sign in" },
];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Cancellations & refunds" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="border-carbon border-t-[3px] border-double">
      <div className="container-public flex flex-col items-center justify-between gap-6 py-10 sm:flex-row">
        <div className="text-center sm:text-left">
          <Logo size="sm" tagline={false} className="sm:items-start" />
        </div>
        <nav aria-label="Footer" className="text-plum/75 flex flex-wrap justify-center gap-x-5 gap-y-2 text-meta">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-plum">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-sand border-t">
        <div className="container-public flex flex-col items-center justify-between gap-3 py-5 sm:flex-row">
          <p className="text-ink-muted text-caption">© {new Date().getFullYear()} {entityName()}</p>
          <nav aria-label="Legal" className="text-ink-muted flex flex-wrap justify-center gap-x-5 gap-y-2 text-caption">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-plum">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

