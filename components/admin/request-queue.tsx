"use client";

import { useState } from "react";
import { Inbox, Loader2 } from "lucide-react";

import { sendQuoteAction, updateRequestAction } from "@/app/(dashboard)/admin/requests/actions";
import { EmptyState } from "@/components/portal/empty-state";
import { Pill } from "@/components/portal/pills";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import type { AdminRequest } from "@/lib/concierge/request-store";
import { isQuotable, MANUAL_STATUSES, quoteLine, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, requestSummary, statusOf, type RequestStatus } from "@/lib/concierge/requests";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The concierge's queue (/admin/requests): each request with its status and the note the requester sees. */
export function RequestQueue({ requests }: { requests: AdminRequest[] }) {
  if (requests.length === 0) return <EmptyState icon={Inbox} title="No requests yet" />;
  return (
    <ul className="grid gap-3">
      {requests.map((r) => (
        <RequestRow key={r.id} request={r} />
      ))}
    </ul>
  );
}

function RequestRow({ request: r }: { request: AdminRequest }) {
  const [status, setStatus] = useState<RequestStatus>(statusOf(r.status));
  const [note, setNote] = useState(r.note ?? "");
  const act = useAction<{ ok: true }>();
  const saved = statusOf(r.status);
  const dirty = status !== saved || note.trim() !== (r.note ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await act.run(() => updateRequestAction({ id: r.id, status, note }), {
      failure: "Couldn't update the request",
      success: () => ({ tone: "success", title: "Request updated" }),
    });
  };

  return (
    <li className="panel grid gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg text-body font-medium">{requestSummary(r)}</p>
          <p className="text-fg-subtle text-caption">
            {r.company_name ?? "No company (admin test)"} ·{" "}
            <a href={`mailto:${r.requester_email}`} className="hover:text-fg underline-offset-2 hover:underline">
              {r.requester_email}
            </a>{" "}
            · {when(r.created_at)}
            {r.per_head_inr ? ` · ${inr(r.per_head_inr)} per head` : ""}
          </p>
        </div>
        <span className="flex items-center gap-2">
          {r.paid ? <Pill tone="ok">Paid</Pill> : null}
          <Pill tone={REQUEST_STATUS_TONE[saved]}>{REQUEST_STATUS_LABEL[saved]}</Pill>
        </span>
      </div>
      {r.details ? <p className="text-fg-muted text-meta whitespace-pre-line">{r.details}</p> : null}
      {r.quote_total_inr != null ? (
        <p className="text-fg text-meta">
          {saved === "booked" ? "Accepted" : "Quoted"}: {quoteLine({ quote_total_inr: Number(r.quote_total_inr), guests: r.guests })}
          {r.quote_note ? <span className="text-fg-subtle"> · {r.quote_note}</span> : null}
        </p>
      ) : null}
      {r.company_id && isQuotable(saved) ? <QuoteForm request={r} /> : null}
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus)} className="field w-auto" aria-label="Status">
          {/* "Quote sent" is set by sending a quote; it shows here only while it's the current status. */}
          {[...MANUAL_STATUSES, ...(saved === "quoted" ? (["quoted"] as const) : [])].map((s) => (
            <option key={s} value={s} disabled={s === "quoted"}>
              {REQUEST_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Note for the requester"
          aria-label="Note for the requester"
          className="field min-w-0 flex-1"
        />
        <button type="submit" className="btn" disabled={!dirty || act.pending || status === "quoted"}>
          {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Save
        </button>
      </form>
    </li>
  );
}

/**
 * The venue's price, sent to the company to accept: the venue, date and guests
 * the quote is for (from the request, corrected here if they changed) and the
 * one total the company pays, taxes and charges included.
 */
function QuoteForm({ request: r }: { request: AdminRequest }) {
  const [open, setOpen] = useState(false);
  const [venue, setVenue] = useState(r.venue_name ?? "");
  const [date, setDate] = useState(r.event_date ?? "");
  const [guests, setGuests] = useState(r.guests ? String(r.guests) : "");
  const [total, setTotal] = useState(r.quote_total_inr != null ? String(Number(r.quote_total_inr)) : "");
  const [note, setNote] = useState(r.quote_note ?? "");
  const act = useAction<{ emailed: boolean }>();
  const requoting = r.quote_total_inr != null;

  if (!open) {
    return (
      <div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {requoting ? "Change quote" : "Send quote"}
        </button>
      </div>
    );
  }

  const perHead = Number(total) > 0 && Number(guests) > 0 ? Math.round(Number(total) / Number(guests)) : null;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const outcome = await act.run(() => sendQuoteAction({ id: r.id, venueName: venue, eventDate: date, guests: Number(guests), totalInr: Number(total), note }), {
      failure: "Couldn't send the quote",
      success: (res) => ({ tone: "success", title: "Quote sent", description: res.emailed ? "The requester was emailed and sees it on Home." : "It's on the requester's Home. The email didn't go out; tell them yourself." }),
    });
    if (outcome?.ok) setOpen(false);
  };

  return (
    <form onSubmit={send} className="border-line grid gap-3 rounded-md border p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-caption">
          <span className="text-fg-subtle">Venue *</span>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} required maxLength={200} className="field" />
        </label>
        <label className="grid gap-1 text-caption">
          <span className="text-fg-subtle">Event date *</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="field" />
        </label>
        <label className="grid gap-1 text-caption">
          <span className="text-fg-subtle">Guests *</span>
          <input type="number" inputMode="numeric" min={1} step={1} value={guests} onChange={(e) => setGuests(e.target.value)} required className="field tabular-nums" />
        </label>
        <label className="grid gap-1 text-caption">
          <span className="text-fg-subtle">Total, taxes included (₹) *</span>
          <input type="number" inputMode="decimal" min={1} step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} required className="field tabular-nums" />
        </label>
      </div>
      <label className="grid gap-1 text-caption">
        <span className="text-fg-subtle">What it covers</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="field" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn" disabled={act.pending}>
          {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {requoting ? "Send new quote" : "Send quote"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={act.pending}>
          Cancel
        </button>
        {perHead ? <span className="text-fg-subtle text-caption tabular-nums">{inr(perHead)} a head</span> : null}
      </div>
    </form>
  );
}
