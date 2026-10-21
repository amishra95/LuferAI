import Link from "next/link";
import { ArrowRight, BrainCircuit, CreditCard, Handshake, Layers, MessagesSquare, ReceiptText, ShieldCheck, Sparkles, Store, type LucideIcon } from "lucide-react";

import { IconTile, type Accent } from "@/components/landing/icon-tile";

/*
 * Landing: what LuferAI is, how a booking flows, and what it can do. Every
 * claim here maps to shipped code; keep it that way when editing (cited inline).
 */

const DIFFERENTIATORS = [
  "Direct venue bidding", // /api/ai/rfp-broadcast, /property, /partner
  "Policy checked before spend", // lib/policies
  "GST-compliant invoicing", // lib/gst-engine.ts
  "Fast model for workspace chat", // lib/ai/model.ts speed: "fast"
];

const STEPS = [
  {
    icon: Sparkles,
    title: "Direct RFP & venue search",
    accent: "coral",
    body: "Describe your corporate event, team dinner or offsite in plain English. LuferAI searches the venue catalogue and can broadcast a structured RFP so matching venues bid on it directly.",
  },
  {
    icon: ShieldCheck,
    title: "Governance before spend",
    accent: "plum",
    body: "Before a rupee is committed, LuferAI checks the request against company and department policy. Anything over policy goes to approvers, with a Slack alert carrying the itemised details.",
  },
  {
    icon: CreditCard,
    title: "Virtual card & settlement",
    accent: "coral",
    body: "Once approved, a single-use virtual card can be issued, capped at the approved invoice total. When the venue confirms, the itemised receipt syncs to your expense system.",
    note: "Cards come from a sandbox issuer today (vc_sandbox_…).",
  },
] satisfies { icon: LucideIcon; accent: Accent; title: string; body: string; note?: string }[];

const CAPABILITIES = [
  {
    icon: BrainCircuit,
    title: "Gemini dual-engine routing",
    accent: "plum",
    body: "gemini-3.1-flash-lite for quick workspace chat; gemini-3.8-flash for multi-step agent work, with runs of up to 300 seconds. Other providers take over if one fails.",
  },
  {
    icon: Store,
    title: "Direct venue engine",
    accent: "coral",
    body: "Property and partner portals where venues receive requests, counter and quote directly to the companies booking them.",
  },
  {
    icon: ShieldCheck,
    title: "Pre-spend policy guardrails",
    accent: "plum",
    body: "Per-head caps, department rules and budgets, an approval chain with Slack escalations, and card limits bound to the approved amount.",
  },
  {
    icon: MessagesSquare,
    title: "Multi-channel",
    accent: "coral",
    body: "The web workspace and concierge chat, a Slack bot, WhatsApp webhooks, and a shared event room with live collaborators.",
  },
  {
    icon: Layers,
    title: "Tenant isolation",
    accent: "plum",
    body: "Each company's data is separated by Postgres row-level security on Supabase. Concierge memory (pgvector) is private to the person who saved it.",
  },
  {
    icon: ReceiptText,
    title: "Expense reconciliation",
    accent: "coral",
    body: "Itemised receipts sync to SAP Concur, Brex, Ramp or your own webhook, so nobody re-keys receipts after the event.",
  },
] satisfies { icon: LucideIcon; accent: Accent; title: string; body: string }[];

// Step badges alternate soft mint and soft coral.
const STEP_BADGES = ["bg-mint-soft text-mint-ink", "bg-coral-soft text-coral-ink"];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="section-block container-public scroll-mt-8">
      <header className="max-w-2xl">
        <p className="text-coral-ink text-xs font-semibold tracking-[0.2em] uppercase">How it works</p>
        <h2 id="how-it-works-title" className="font-display text-plum mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          The architecture of execution
        </h2>
        <p className="text-ink-muted mt-4">
          How LuferAI takes the middleman out of venue sourcing, automates pre-spend governance and coordinates
          venue procurement from one request.
        </p>
      </header>

      {/* What LuferAI is */}
      <div className="landing-card mt-10 p-8">
        <p className="text-coral-ink text-xs font-semibold tracking-[0.2em] uppercase">What is LuferAI</p>
        <p className="font-display text-plum mt-3 max-w-3xl text-2xl font-semibold leading-snug">
          A Gemini-powered B2B platform for corporate dining, venue booking and hospitality procurement.
        </p>
        <p className="text-plum/80 mt-3 max-w-3xl">
          Requests, policy, approvals, payment and GST invoicing in one flow, with venues quoting your company
          directly instead of through a closed marketplace network.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Differentiators">
          {DIFFERENTIATORS.map((d) => (
            <li key={d} className="border-sand bg-linen text-plum inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-meta">
              <span aria-hidden className="status-dot bg-coral" />
              {d}
            </li>
          ))}
        </ul>
      </div>

      {/* Three steps */}
      <ol className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="landing-card flex flex-col p-8">
            <div className="flex items-center justify-between">
              <span className="font-display text-plum/25 text-4xl leading-none font-semibold">{String(i + 1).padStart(2, "0")}</span>
              <span className={`${STEP_BADGES[i % 2]} rounded-full px-3 py-1 text-caption font-semibold`}>Step {i + 1}</span>
            </div>
            <h3 className="font-display text-plum mt-6 text-xl font-semibold">{s.title}</h3>
            <p className="text-plum/80 mt-3">{s.body}</p>
            {s.note ? <p className="text-ink-muted mt-auto pt-4 text-caption">{s.note}</p> : null}
          </li>
        ))}
      </ol>

      {/* Capabilities */}
      <h3 className="font-display text-plum mt-20 text-2xl font-semibold tracking-tight sm:text-3xl">Everything LuferAI does</h3>
      <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((c) => (
          <li key={c.title} className="landing-card p-8">
            <IconTile icon={c.icon} accent={c.accent} />
            <h4 className="font-display text-plum mt-6 text-lg font-semibold">{c.title}</h4>
            <p className="text-ink-muted mt-2 text-meta">{c.body}</p>
          </li>
        ))}
      </ul>

      {/* Closing call to action */}
      <div className="landing-card mt-16 flex flex-col items-start justify-between gap-6 p-8 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <IconTile icon={Handshake} accent="coral" />
          <div>
            <p className="font-display text-plum text-lg font-semibold">Plan your next team outing</p>
            <p className="text-ink-muted text-meta">Describe it once; LuferAI handles venues, approvals and payment.</p>
          </div>
        </div>
        <Link href="/client" className="landing-btn landing-btn-primary">
          Request an event <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
