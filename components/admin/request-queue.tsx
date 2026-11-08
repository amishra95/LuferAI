"use client";

import { useState } from "react";
import { Inbox, Loader2 } from "lucide-react";

import { updateRequestAction } from "@/app/(dashboard)/admin/requests/actions";
import { EmptyState } from "@/components/portal/empty-state";
import { Pill } from "@/components/portal/pills";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import type { AdminRequest } from "@/lib/concierge/request-store";
import { REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, REQUEST_STATUSES, requestSummary, statusOf, type RequestStatus } from "@/lib/concierge/requests";

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
        <Pill tone={REQUEST_STATUS_TONE[saved]}>{REQUEST_STATUS_LABEL[saved]}</Pill>
      </div>
      {r.details ? <p className="text-fg-muted text-meta whitespace-pre-line">{r.details}</p> : null}
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus)} className="field w-auto" aria-label="Status">
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
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
        <button type="submit" className="btn" disabled={!dirty || act.pending}>
          {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Save
        </button>
      </form>
    </li>
  );
}
