"use client";

import { useState } from "react";
import { BellRing, Check, ChevronDown, History, Loader2, Send, X } from "lucide-react";

import { decideEscalationAction, saveAlertNumberAction } from "@/app/(dashboard)/escalation-actions";
import { Pill, type PillTone } from "@/components/portal/pills";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { STATUS_LABEL, type EscalationAction, type EscalationStatus } from "@/lib/escalations/rules";
import type { Escalation, EscalationEvent } from "@/lib/escalations/store";
import { cn, formatDate, formatINR } from "@/lib/utils";

const STATUS_TONE: Record<EscalationStatus, PillTone> = { open: "warn", approved: "ok", modified: "ok", rejected: "neutral", superseded: "neutral" };

const ACTION_LABEL: Record<EscalationAction, string> = {
  opened: "Held back by the escalation thresholds",
  approved: "Approved as proposed",
  modified: "Sent at a new price",
  rejected: "Rejected: instant quote stands",
  superseded: "Superseded",
  reopened: "Reopened",
  notified: "Notified",
  notify_failed: "Notification failed",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pctOff = (price: number, standard: number | null) => (standard ? `${((1 - price / standard) * 100).toFixed(1)}% off` : null);

function describe(e: EscalationEvent): string {
  const d = e.detail;
  const parts = [ACTION_LABEL[e.action]];
  if (typeof d.channel === "string") parts.push(d.channel === "in-app" ? "in the app" : `on ${d.channel === "slack" ? "Slack" : "WhatsApp"}`);
  if (typeof d.perHead === "number") parts.push(`${formatINR(d.perHead)}/head`);
  if (typeof d.how === "string") parts.push(d.how);
  if (typeof d.reason === "string" && e.action !== "opened") parts.push(d.reason);
  if (typeof d.note === "string" && d.note) parts.push(`“${d.note}”`);
  if (typeof d.error === "string") parts.push(d.error);
  return parts.join(" · ");
}

function Trail({ events }: { events: EscalationEvent[] }) {
  return (
    <ol className="border-line grid gap-1 border-l pl-3 text-[12px]" aria-label="Audit trail">
      {events.map((e) => (
        <li key={e.id} className={cn("text-fg-subtle", e.action === "notify_failed" && "text-rose")}>
          <time className="text-fg-faint mr-2 font-mono tabular-nums" dateTime={e.at}>
            {when(e.at)}
          </time>
          {describe(e)}
          <span className="text-fg-faint"> · {e.actorRole === "system" ? "system" : e.actorRole === "ADMIN" ? "admin" : "venue host"}</span>
        </li>
      ))}
    </ol>
  );
}

function Header({ e, showVenue }: { e: Escalation; showVenue: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-fg font-medium">{e.companyName}</span>
      {showVenue ? <span className="text-fg-subtle text-[12.5px]">at {e.venueName}</span> : null}
      <span className="text-fg-subtle text-[12.5px]">
        {e.partySize} guests{e.rfp.eventDate ? ` · ${formatDate(e.rfp.eventDate)}` : ""}
        {e.rfp.budgetPerHead !== null ? ` · budget ${formatINR(e.rfp.budgetPerHead)}/head` : ""}
      </span>
      <Pill tone={STATUS_TONE[e.status]} className="ml-auto">
        {STATUS_LABEL[e.status]}
      </Pill>
    </div>
  );
}

function OpenItem({ e, showVenue }: { e: Escalation; showVenue: boolean }) {
  const [price, setPrice] = useState(String(e.proposedPerHead));
  const [note, setNote] = useState("");
  const [showTrail, setShowTrail] = useState(false);
  const act = useAction<Escalation>();
  const decide = (action: "approve" | "modify" | "reject") =>
    act.run(() => decideEscalationAction(e.id, { action, perHead: price, note }), {
      failure: action === "reject" ? "Couldn't reject the counter" : "Couldn't send the counter",
      success: (r) => ({
        tone: "success",
        title: r.status === "rejected" ? "Rejected: the instant quote stands" : `Counter sent at ${formatINR(r.decidedPerHead ?? e.proposedPerHead)}/head`,
        description: `${e.companyName} sees it in their RFP comparison.`,
      }),
    });
  const modified = Number(price) !== e.proposedPerHead;

  return (
    <li className="grid gap-3 py-4 first:pt-0">
      <Header e={e} showVenue={showVenue} />
      <dl className="grid grid-cols-3 gap-3 text-[12.5px]">
        <div>
          <dt className="label-mono">Venue price</dt>
          <dd className="font-mono tabular-nums">{e.standardPerHead !== null ? `${formatINR(e.standardPerHead)}/head` : "—"}</dd>
        </div>
        <div>
          <dt className="label-mono">Client sees now</dt>
          <dd className="font-mono tabular-nums">{e.response.perHead !== null ? `${formatINR(e.response.perHead)}/head` : "—"}</dd>
        </div>
        <div>
          <dt className="label-mono">Proposed counter</dt>
          <dd className="text-fg font-mono tabular-nums">
            {formatINR(e.proposedPerHead)}/head <span className="text-fg-subtle">{pctOff(e.proposedPerHead, e.standardPerHead)}</span>
          </dd>
        </div>
      </dl>
      <p className="text-fg-subtle text-[12.5px] leading-5">{e.reason}</p>
      <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto] sm:items-end">
        <label className="grid gap-1 text-[12px]">
          <span className="text-fg-subtle">Per head to send</span>
          <input value={price} onChange={(ev) => setPrice(ev.target.value)} inputMode="decimal" className="field font-mono" aria-label="Per-head price to send" />
        </label>
        <label className="grid gap-1 text-[12px]">
          <span className="text-fg-subtle">Note to client (optional)</span>
          <input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={280} className="field" placeholder="e.g. Includes welcome drinks" />
        </label>
        <div className="flex flex-wrap gap-2">
          {modified ? (
            <button type="button" className="btn btn-primary h-8 px-3 text-[12.5px]" disabled={act.pending} onClick={() => decide("modify")}>
              {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />} Send at {price ? formatINR(Number(price) || 0) : "…"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary h-8 px-3 text-[12.5px]" disabled={act.pending} onClick={() => decide("approve")}>
              {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />} Approve
            </button>
          )}
          <button type="button" className="btn h-8 px-3 text-[12.5px]" disabled={act.pending} onClick={() => decide("reject")} title="Don't counter; the instant quote stands">
            <X className="size-3.5" aria-hidden /> Reject
          </button>
        </div>
      </div>
      <p className="text-fg-faint text-[11.5px]">Counters are checked against the venue&apos;s guardrails and the platform&apos;s caps before they&apos;re sent.</p>
      <button type="button" className="text-fg-subtle hover:text-fg inline-flex items-center gap-1 justify-self-start text-[12px]" onClick={() => setShowTrail((v) => !v)} aria-expanded={showTrail}>
        <History className="size-3.5" aria-hidden /> Audit trail ({e.events.length})
        <ChevronDown className={cn("size-3.5 transition-transform", showTrail && "rotate-180")} aria-hidden />
      </button>
      {showTrail ? <Trail events={e.events} /> : null}
    </li>
  );
}

function AlertNumber({ venueId, number }: { venueId: string; number: string | null }) {
  const [value, setValue] = useState(number ?? "");
  const save = useAction<{ phone: string | null }>();
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-[12px]"
      onSubmit={(ev) => {
        ev.preventDefault();
        void save.run(() => saveAlertNumberAction(venueId, value), {
          failure: "Couldn't save the alert number",
          success: (r) => ({ tone: "success", title: r.phone ? `WhatsApp alerts go to ${r.phone}` : "WhatsApp alerts off" }),
        });
      }}
    >
      <BellRing className="text-fg-subtle size-3.5" aria-hidden />
      <label htmlFor={`alert-${venueId}`} className="text-fg-subtle">
        WhatsApp alerts to
      </label>
      <input id={`alert-${venueId}`} value={value} onChange={(ev) => setValue(ev.target.value)} placeholder="+91 98450 12345" className="field h-7 w-40 py-0 font-mono text-[12px]" />
      <button type="submit" className="btn h-7 px-2.5 text-[12px]" disabled={save.pending || value === (number ?? "")}>
        Save
      </button>
    </form>
  );
}

/**
 * Counter-offers held back by the platform's escalation thresholds, for a
 * person to approve, send at another price, or reject. `showVenue` on /agents
 * (every venue); `alert` on /property (the host's WhatsApp alert number).
 */
export function EscalationQueue({
  open,
  recent,
  ready,
  showVenue = false,
  alert,
}: {
  open: Escalation[];
  recent: Escalation[];
  ready: boolean;
  showVenue?: boolean;
  alert?: { venueId: string; number: string | null };
}) {
  const [trailFor, setTrailFor] = useState<string | null>(null);
  if (!ready) {
    return (
      <p role="status" className="border-line text-fg-subtle rounded-lg border border-dashed px-4 py-4 text-[13px]">
        The escalation queue needs the Supabase database with migration 0029 (negotiation_escalations). Until then, held-back counters only show in the RFP inbox notes and the activity feed.
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {alert ? <AlertNumber venueId={alert.venueId} number={alert.number} /> : null}
      {open.length === 0 ? (
        <p className="text-fg-subtle text-[13px]">Nothing waiting. Automatic counters past the escalation thresholds land here for review.</p>
      ) : (
        <ul className="divide-line divide-y">
          {open.map((e) => (
            <OpenItem key={e.id} e={e} showVenue={showVenue} />
          ))}
        </ul>
      )}
      {recent.length > 0 ? (
        <details className="border-line group rounded-lg border">
          <summary className="hover:bg-surface-hover flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]">
            <History className="text-fg-subtle size-3.5" aria-hidden />
            <span className="label-mono">Recent decisions · {recent.length}</span>
            <ChevronDown className="text-fg-subtle ml-auto size-3.5 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-line divide-y px-3 pb-2">
            {recent.map((e) => (
              <li key={e.id} className="grid gap-2 py-3">
                <Header e={e} showVenue={showVenue} />
                <p className="text-fg-subtle text-[12.5px]">
                  Proposed {formatINR(e.proposedPerHead)}/head
                  {e.decidedPerHead !== null ? ` · sent ${formatINR(e.decidedPerHead)}/head` : ""}
                  {e.status === "open" ? " · RFP closed before review" : ""}
                  {e.decisionNote ? ` · ${e.decisionNote}` : ""}
                  {e.decidedAt ? ` · ${when(e.decidedAt)}` : ""}
                </p>
                <button type="button" className="text-fg-subtle hover:text-fg inline-flex items-center gap-1 justify-self-start text-[12px]" onClick={() => setTrailFor((v) => (v === e.id ? null : e.id))} aria-expanded={trailFor === e.id}>
                  <History className="size-3.5" aria-hidden /> Audit trail ({e.events.length})
                </button>
                {trailFor === e.id ? <Trail events={e.events} /> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
