import Link from "next/link";
import { ArrowRight, BrainCircuit, CreditCard, Handshake, Layers, MessagesSquare, ReceiptText, ShieldCheck, Sparkles, Store, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

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
    title: "Direct RFP and venue search",
    body: "Describe your corporate event, team dinner or offsite in plain English. LuferAI searches the venue catalogue and can broadcast a structured RFP so matching venues bid on it directly.",
  },
  {
    icon: ShieldCheck,
    title: "Governance before spend",
    body: "Before a rupee is committed, LuferAI checks the request against company and department policy. Anything over policy goes to approvers, with a Slack alert carrying the itemised details.",
  },
  {
    icon: CreditCard,
    title: "Virtual card and settlement",
    body: "Once approved, a single-use virtual card can be issued, capped at the approved invoice total. When the venue confirms, the itemised receipt syncs to your expense system.",
    note: "Cards come from a sandbox issuer today (vc_sandbox_…).",
  },
] satisfies { icon: LucideIcon; title: string; body: string; note?: string }[];

const CAPABILITIES = [
  {
    icon: BrainCircuit,
    title: "Gemini dual-engine routing",
    body: "gemini-3.1-flash-lite for quick workspace chat; gemini-3.8-flash for multi-step agent work, with runs of up to 300 seconds. Other providers take over if one fails.",
  },
  {
    icon: Store,
    title: "Direct venue engine",
    body: "Property and partner portals where venues receive requests, counter and quote directly to the companies booking them.",
  },
  {
    icon: ShieldCheck,
    title: "Pre-spend policy guardrails",
    body: "Per-head caps, department rules and budgets, an approval chain with Slack escalations, and card limits bound to the approved amount.",
  },
  {
    icon: MessagesSquare,
    title: "Multi-channel",
    body: "The web workspace and concierge chat, a Slack bot, WhatsApp webhooks, and a shared event room with live collaborators.",
  },
  {
    icon: Layers,
    title: "Tenant isolation",
    body: "Each company's data is separated by Postgres row-level security on Supabase. Concierge memory (pgvector) is private to the person who saved it.",
  },
  {
    icon: ReceiptText,
    title: "Expense reconciliation",
    body: "Itemised receipts sync to SAP Concur, Brex, Ramp or your own webhook, so nobody re-keys receipts after the event.",
  },
] satisfies { icon: LucideIcon; title: string; body: string }[];

function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-md", className)}>
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="section-block border-frame border-t">
      <header className="max-w-2xl">
        <span className="badge-warn rounded-badge inline-flex items-center px-2.5 py-0.5 text-caption leading-4 font-medium">How it works</span>
        <h2 id="how-it-works" className="font-display text-hero text-fg mt-3 font-semibold">
          The architecture of execution
        </h2>
        <p className="text-fg-subtle mt-3">
          How LuferAI takes the middleman out of venue sourcing, automates pre-spend governance and coordinates
          venue procurement from one request.
        </p>
      </header>

      {/* What LuferAI is */}
      <div className="on-plum container-block border-plum-light mt-10 border px-6 py-8 sm:px-10">
        <p className="text-gold text-meta font-semibold">What is LuferAI</p>
        <p className="font-display text-section mt-2 max-w-3xl font-semibold leading-snug">
          A Gemini-powered B2B platform for corporate dining, venue booking and hospitality procurement.
        </p>
        <p className="text-fg-subtle mt-3 max-w-3xl">
          Requests, policy, approvals, payment and GST invoicing in one flow, with venues quoting your company
          directly instead of through a closed marketplace network.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Differentiators">
          {DIFFERENTIATORS.map((d) => (
            <li key={d} className="bg-plum-light text-fg rounded-badge inline-flex h-7 items-center gap-1.5 px-2.5 text-meta">
              <span aria-hidden className="status-dot bg-mint" />
              {d}
            </li>
          ))}
        </ul>
      </div>

      {/* Three steps */}
      <ol className="mt-10 grid gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="panel flex flex-col p-6">
            <div className="flex items-center justify-between">
              <IconTile icon={s.icon} className="bg-surface-raised text-link" />
              <span className="badge-success rounded-badge inline-flex items-center px-2.5 py-0.5 text-caption leading-4 font-medium">Step {i + 1}</span>
            </div>
            <h3 className="text-card-title text-fg mt-4 font-semibold">{s.title}</h3>
            <p className="text-fg-subtle mt-2">{s.body}</p>
            {s.note ? <p className="text-fg-subtle mt-3 text-caption">{s.note}</p> : null}
          </li>
        ))}
      </ol>

      {/* Capabilities */}
      <h3 className="text-section text-fg mt-16 font-semibold">Everything LuferAI does</h3>
      <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((c) => (
          <li key={c.title} className="panel flex gap-4 p-6">
            <IconTile icon={c.icon} className="on-plum text-gold" />
            <div className="min-w-0">
              <h4 className="text-card-title text-fg font-semibold">{c.title}</h4>
              <p className="text-fg-subtle mt-1.5 text-meta">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* The page's one primary action */}
      <div className="panel mt-12 flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-4">
          <IconTile icon={Handshake} className="bg-surface-raised text-link" />
          <div>
            <p className="text-card-title text-fg font-semibold">Plan your next event</p>
            <p className="text-fg-subtle text-meta">Describe it once; LuferAI handles venues, approvals and payment.</p>
          </div>
        </div>
        <Link href="/client" className="btn btn-primary h-11 px-5 text-body">
          Request an event <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
