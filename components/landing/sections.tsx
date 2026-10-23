import Link from "next/link";
import {
  ArrowRight,
  BadgeIndianRupee,
  BellRing,
  CalendarCheck,
  Check,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  Handshake,
  Inbox,
  MapPinned,
  MessageCircle,
  Minus,
  ReceiptText,
  ScanText,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { IconTile } from "@/components/landing/icon-tile";

/*
 * Landing sections below the hero. Every claim maps to shipped code (cited
 * inline); keep it that way when editing. No invented logos, stats or quotes:
 * add real ones to <TrustBand> as customers sign.
 */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-emerald-ink text-xs font-semibold tracking-[0.2em] uppercase">{children}</p>;
}

function SectionHeader({ eyebrow, title, body, id, center }: { eyebrow: string; title: string; body?: string; id: string; center?: boolean }) {
  return (
    <header className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="font-display text-graphite mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {body ? <p className="text-ink-muted mt-4 text-pretty sm:text-lg">{body}</p> : null}
    </header>
  );
}

/* India-first band ------------------------------------------------------- */

const INDIA = [
  { icon: ReceiptText, title: "CGST + SGST or IGST, worked out for you", body: "From the GSTINs of your company and the venue" }, // lib/gst-engine.ts
  { icon: MessageCircle, title: "WhatsApp approvals", body: "Approve or decline from one message, with no login needed" }, // lib/approvals/whatsapp-buttons.ts
  { icon: FileSpreadsheet, title: "Tally Prime, Zoho, ERPNext", body: "Vouchers export straight to your books" }, // lib/finance/tally-xml.ts, lib/finance/expense-adapters.ts
  { icon: BadgeIndianRupee, title: "Rupees and your financial year", body: "April–March budgets, with paise-exact maths" }, // lib/fiscal-year.ts
];

export function IndiaBand() {
  return (
    <section aria-label="Built for India" className="container-public">
      <div className="border-sand grid grid-cols-1 gap-px overflow-hidden rounded-2xl border bg-[var(--color-sand)] sm:grid-cols-2 lg:grid-cols-4">
        {INDIA.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex items-start gap-3 bg-white/85 p-5">
            <Icon className="text-emerald-ink mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            <div>
              <p className="text-graphite text-meta font-semibold">{title}</p>
              <p className="text-ink-muted text-caption">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* Workflow --------------------------------------------------------------- */

const STEPS = [
  { icon: Sparkles, title: "Brief", body: "Type it in plain English, or let the AI concierge turn a quick chat into a structured RFP." }, // /api/ai/generate-brief
  { icon: MapPinned, title: "Compare", body: "See matched venues with distance from your office, in-policy flags and what coworkers booked." }, // lib/venues signals, PostGIS
  { icon: Handshake, title: "Get direct quotes", body: "The RFP goes to matching venues, who quote you directly. Dates are held while you decide." }, // /api/ai/rfp-broadcast, lib/locks
  { icon: ShieldCheck, title: "Approve", body: "Policy is checked before any spend. Anything over a limit goes to the right approver on WhatsApp or Slack." }, // lib/policies, lib/approvals
  { icon: WalletCards, title: "Pay", body: "Pay the deposit online. Venues are paid out on clear terms once the event is completed." }, // /api/payments, lib/marketplace/settlement.ts
  { icon: ReceiptText, title: "Reconcile", body: "You get a GST tax invoice with ITC tracked, and it syncs to Tally, Zoho or your expense tool." }, // lib/finance
] satisfies { icon: LucideIcon; title: string; body: string }[];

export function Workflow() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="section-block container-public scroll-mt-20">
      <SectionHeader
        id="how-title"
        eyebrow="How it works"
        title="From “we need a venue” to a reconciled invoice"
        body="Six steps that usually take a week of emails, calls and spreadsheets, handled in one place."
      />
      <ol className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map(({ icon, title, body }, i) => (
          <li key={title} className="landing-card relative flex flex-col p-6">
            <div className="flex items-center justify-between">
              <IconTile icon={icon} accent={i % 2 ? "graphite" : "emerald"} />
              <span className="font-display text-graphite/15 text-4xl leading-none font-semibold tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <h3 className="font-display text-graphite mt-5 text-xl font-semibold">{title}</h3>
            <p className="text-graphite/75 mt-2 text-meta">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* Audiences ---------------------------------------------------------------- */

type Feature = { icon: LucideIcon; title: string; body: string };

const ORGANISERS: Feature[] = [
  { icon: Sparkles, title: "AI concierge", body: "It remembers your team's preferences and books from chat, on the web, Slack or WhatsApp." }, // lib/agent/memory.ts, channels
  { icon: Users, title: "Guest list & RSVPs", body: "Invite links, dietary needs, calendar invites and a shared event room." }, // lib/events
  { icon: CalendarCheck, title: "Holds that don't vanish", body: "A countdown on every held date, released automatically if you pass." }, // components/portal/hold-countdown.tsx, cron/release-holds
];

const FINANCE: Feature[] = [
  { icon: ShieldCheck, title: "Pre-spend policy", body: "Per-head caps, department budgets and tiered approval chains, enforced before booking." }, // lib/policies
  { icon: Gauge, title: "Spend & forecast", body: "Spend by department or cost centre, with a forecast against budget." }, // /api/analytics/forecast
  { icon: ClipboardCheck, title: "ITC governance", body: "Claim or block input tax credit per invoice, with an audit trail." }, // lib/finance/itc.ts
  { icon: ScanText, title: "Invoice OCR check", body: "Invoices are read and matched against the booking, so mismatches get flagged." }, // /api/finance/ocr-reconcile
  { icon: FileSpreadsheet, title: "ERP export", body: "Tally Prime XML, Zoho Books and ERPNext, plus PO ledgers per cost centre." }, // lib/finance/tally-xml.ts
  { icon: ReceiptText, title: "Expense sync", body: "Itemised receipts go to SAP Concur, Brex, Ramp or a webhook." }, // lib/expense
];

function FeatureGrid({ items, cols = 3 }: { items: Feature[]; cols?: 2 | 3 }) {
  return (
    <ul className={`mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""}`}>
      {items.map(({ icon: Icon, title, body }) => (
        <li key={title} className="flex gap-3">
          <Icon className="text-emerald-ink mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <div>
            <p className="text-graphite font-semibold">{title}</p>
            <p className="text-ink-muted text-meta">{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Audiences() {
  return (
    <>
      <section aria-labelledby="organisers-title" className="section-block container-public">
        <div className="landing-card grid gap-10 p-8 lg:grid-cols-[1fr_1.4fr] lg:p-12">
          <div>
            <Eyebrow>For HR, EAs & team leads</Eyebrow>
            <h2 id="organisers-title" className="font-display text-graphite mt-3 text-3xl font-semibold tracking-tight">
              Plan it like you have an events team
            </h2>
            <p className="text-ink-muted mt-4">
              Offsites, all-hands, client dinners, Diwali parties. Tell Lufer what you need and get options you can
              actually book, inside your company&apos;s rules.
            </p>
          </div>
          <FeatureGrid items={ORGANISERS} cols={2} />
        </div>
      </section>

      <section id="finance" aria-labelledby="finance-title" className="on-graphite landing-dark scroll-mt-16">
        <div className="section-block container-public">
          <header className="max-w-2xl">
            <p className="text-gold text-xs font-semibold tracking-[0.2em] uppercase">For finance & procurement</p>
            <h2 id="finance-title" className="font-display text-linen mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Every rupee approved before it&apos;s spent, and reconciled after
            </h2>
            <p className="text-on-graphite-muted mt-4 sm:text-lg">
              One supplier on your books, policy checked up front, and GST you can claim.
            </p>
          </header>
          <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FINANCE.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <Icon className="text-gold size-5" strokeWidth={1.75} aria-hidden />
                <p className="text-linen mt-4 font-semibold">{title}</p>
                <p className="text-on-graphite-muted mt-1 text-meta">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

/* Venues (supply side) ----------------------------------------------------- */

const VENUE_FEATURES: Feature[] = [
  { icon: Inbox, title: "Corporate requests, ready to quote", body: "Party size, budget, dates and dietary needs, all in one brief." }, // property portal
  { icon: Sparkles, title: "AI inquiry assistant", body: "A public inquiry page that answers questions from your venue's own facts, around the clock." }, // app/inquire/[venueId]
  { icon: BellRing, title: "WhatsApp alerts & magic links", body: "Quote from your phone without logging in." }, // lib/vendor/quote-link.ts
  { icon: Store, title: "Book of business", body: "See every client company, when they're due to rebook, and what to offer them next." }, // property/_components/account-book.tsx
];

export function ForVenues() {
  return (
    <section id="venues" aria-labelledby="venues-title" className="section-block container-public scroll-mt-20">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <SectionHeader
            id="venues-title"
            eyebrow="For venues & partners"
            title="Win corporate business without the agency in between"
            body="Restaurants, hotels, experience studios, caterers and artists: get structured requests from companies and quote them directly."
          />
          <Link href="/signup?type=partner" className="landing-btn landing-btn-outline mt-8">
            List your venue <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <FeatureGrid items={VENUE_FEATURES} cols={2} />
      </div>
    </section>
  );
}

/* Comparison --------------------------------------------------------------- */

type Cell = boolean | "partial" | string;
const ROWS: { label: string; lufer: Cell; agency: Cell; manual: Cell }[] = [
  { label: "Quotes direct from venues", lufer: true, agency: "Through the agency", manual: true },
  { label: "Policy checked before booking", lufer: true, agency: false, manual: false },
  { label: "Approvals on WhatsApp / Slack", lufer: true, agency: false, manual: "partial" },
  { label: "GST invoice with ITC tracked", lufer: true, agency: "partial", manual: false },
  { label: "Exports to Tally / Zoho / ERPNext", lufer: true, agency: false, manual: false },
  { label: "Spend by department & cost centre", lufer: true, agency: false, manual: "Spreadsheets" },
];

function Mark({ value }: { value: Cell }) {
  if (value === true) return <Check className="text-mint-ink mx-auto size-5" aria-label="Yes" />;
  if (value === false) return <X className="text-graphite/30 mx-auto size-5" aria-label="No" />;
  if (value === "partial") return <Minus className="text-gold-ink mx-auto size-5" aria-label="Partly" />;
  return <span className="text-ink-muted text-caption">{value}</span>;
}

export function Comparison() {
  return (
    <section aria-labelledby="compare-title" className="section-block container-public">
      <SectionHeader id="compare-title" eyebrow="Why Lufer" title="Compared with how it's usually done" center />
      <div className="landing-card mt-10 overflow-x-auto p-0 hover:translate-y-0">
        <table className="w-full min-w-[36rem] text-left text-meta">
          <thead>
            <tr className="border-sand border-b">
              <th scope="col" className="text-ink-muted p-4 font-medium">
                <span className="sr-only">Capability</span>
              </th>
              <th scope="col" className="bg-emerald-soft/60 text-graphite p-4 text-center font-semibold">Lufer.ai</th>
              <th scope="col" className="text-ink-muted p-4 text-center font-medium">Event agency</th>
              <th scope="col" className="text-ink-muted p-4 text-center font-medium">Email & spreadsheets</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-sand border-b last:border-0">
                <th scope="row" className="text-graphite p-4 font-medium">{r.label}</th>
                <td className="bg-emerald-soft/30 p-4 text-center"><Mark value={r.lufer} /></td>
                <td className="p-4 text-center"><Mark value={r.agency} /></td>
                <td className="p-4 text-center"><Mark value={r.manual} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* FAQ ------------------------------------------------------------------------ */

const FAQ = [
  {
    q: "Who is Lufer for?",
    a: "Companies in India that book team events, offsites, client entertainment and catering, and the venues and partners who host them.",
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
    q: "Do our approvers need to log in?",
    a: "No. Requests over policy reach approvers on WhatsApp or Slack, and they approve or decline in one tap, with the itemised details in the message.",
  },
  {
    q: "Is our data kept separate from other companies?",
    a: "Yes. Every table is isolated per company by Postgres row-level security, and concierge memory is private to the person who saved it.",
  },
  {
    q: "How do we get started?",
    a: "Apply for an account. We review every application, usually within one working day, and then your team can book straight away.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="section-block container-public scroll-mt-20">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeader id="faq-title" eyebrow="FAQ" title="Questions teams ask us" />
        <div className="divide-sand border-sand divide-y border-y">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="landing-faq group py-5">
              <summary className="text-graphite flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span aria-hidden className="border-sand text-graphite/60 grid size-7 shrink-0 place-items-center rounded-full border transition-transform group-open:rotate-45">
                  +
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
      <div className="on-graphite landing-dark relative overflow-hidden rounded-[1.75rem] px-6 py-14 text-center sm:px-12">
        <div aria-hidden className="landing-glow landing-glow-cta" />
        <h2 id="cta-title" className="font-display text-linen relative mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Your next offsite, without the week of emails
        </h2>
        <p className="text-on-graphite-muted relative mx-auto mt-4 max-w-xl">
          Apply in two minutes. We review every account, usually within one working day.
        </p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="landing-btn landing-btn-primary w-full sm:w-auto">
            Plan your first event <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href="/signup?type=partner" className="landing-btn landing-btn-ghost w-full sm:w-auto">
            I run a venue
          </Link>
        </div>
      </div>
    </section>
  );
}

const FOOTER_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#finance", label: "For finance" },
  { href: "#venues", label: "For venues" },
  { href: "#faq", label: "FAQ" },
  { href: "/login", label: "Sign in" },
];

export function SiteFooter() {
  return (
    <footer className="border-sand border-t">
      <div className="container-public flex flex-col items-center justify-between gap-6 py-10 sm:flex-row">
        <div className="text-center sm:text-left">
          <Logo size="sm" tagline={false} className="sm:items-start" />
          <p className="text-ink-muted mt-3 text-caption">Corporate events and hospitality for India.</p>
        </div>
        <nav aria-label="Footer" className="text-graphite/75 flex flex-wrap justify-center gap-x-5 gap-y-2 text-meta">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-graphite">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

