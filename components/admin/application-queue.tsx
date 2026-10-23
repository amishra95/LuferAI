"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";

import { approveUser, rejectUser, type DecisionResult } from "@/app/(dashboard)/admin/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PARTNER_KIND_LABEL, type PartnerKind } from "@/lib/auth/signup-input";
import type { SignupApplication } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type QueueItem = SignupApplication & {
  /** Enterprise applicants whose GSTIN is already a customer: approving adds them to it as an Organizer. */
  joinsCompany: string | null;
};

const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const kindLabel = (k: string | null) => (k ? (PARTNER_KIND_LABEL[k as PartnerKind] ?? k) : null);

function Outcome({ result }: { result: DecisionResult | null }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={cn("text-meta", result.ok ? "text-sage" : "text-rose")}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

function PendingCard({ a }: { a: QueueItem }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const done = result?.ok;

  const facts: [string, React.ReactNode][] = [
    ["Email", a.email],
    ...(a.phone ? [["Mobile", a.phone] as [string, React.ReactNode]] : []),
    ...(a.job_title ? [["Role", a.job_title] as [string, React.ReactNode]] : []),
    ...(a.partner_role ? [["Offers", kindLabel(a.partner_role)] as [string, React.ReactNode]] : []),
    ...(a.venue_website
      ? [
          [
            "Website",
            <a key="w" href={a.venue_website} target="_blank" rel="noopener noreferrer nofollow" className="text-link inline-flex items-center gap-1 break-all underline-offset-2 hover:underline">
              {a.venue_website.replace(/^https?:\/\//, "")}
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(a.gstin ? [["GSTIN", <span key="g" className="font-mono">{a.gstin}</span>] as [string, React.ReactNode]] : []),
    ...(a.city ? [["City", a.city] as [string, React.ReactNode]] : []),
  ];

  return (
    <li className={cn("panel grid gap-4 p-5", done && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-body font-medium">{a.full_name}</p>
          <p className="text-fg-subtle text-meta">
            {a.company_name} · applied {when.format(new Date(a.created_at))}
          </p>
        </div>
        <Badge variant={a.account_type === "partner" ? "secondary" : "default"}>{a.account_type === "partner" ? "Partner" : "Enterprise"}</Badge>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-meta">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-subtle">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {a.message ? <p className="border-line text-fg-muted rounded-md border px-3 py-2 text-meta whitespace-pre-line">{a.message}</p> : null}
      {a.joinsCompany ? (
        <p role="note" className="badge-warn rounded-md px-3 py-2 text-meta">
          This GSTIN belongs to {a.joinsCompany}. Approving adds {a.full_name.split(" ")[0]} to that company as an Organizer: check they work there.
        </p>
      ) : null}

      {rejecting && !done ? (
        <div className="grid gap-2">
          <label htmlFor={`reason-${a.id}`} className="text-meta font-medium">
            Reason (optional, shown to the applicant)
          </label>
          <textarea id={`reason-${a.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="field h-auto py-2" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {rejecting ? (
          <>
            <Button variant="destructive" disabled={pending || done} onClick={() => start(async () => setResult(await rejectUser(a.user_id, reason)))}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
              Reject application
            </Button>
            <Button variant="ghost" disabled={pending || done} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button disabled={pending || done} onClick={() => start(async () => setResult(await approveUser(a.user_id)))}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              Approve
            </Button>
            <Button variant="outline" disabled={pending || done} onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          </>
        )}
        <Outcome result={result} />
      </div>
    </li>
  );
}

/** The pending queue, oldest first, and the latest decisions. */
export function ApplicationQueue({ pending, decided }: { pending: QueueItem[]; decided: QueueItem[] }) {
  return (
    <div className="grid gap-8">
      <section aria-labelledby="pending-heading" className="grid gap-3">
        <h2 id="pending-heading" className="text-section text-fg font-semibold">
          Waiting for review <span className="text-fg-subtle font-normal">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="panel text-fg-subtle p-6 text-meta">No applications waiting. New ones appear here once the applicant confirms their email.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {pending.map((a) => (
              <PendingCard key={a.id} a={a} />
            ))}
          </ul>
        )}
      </section>

      {decided.length ? (
        <section aria-labelledby="decided-heading" className="grid gap-3">
          <h2 id="decided-heading" className="text-section text-fg font-semibold">
            Recently decided
          </h2>
          <div className="table-frame">
            <table className="w-full min-w-[40rem] text-meta">
              <thead>
                <tr className="border-line bg-surface-hover border-b">
                  {["Applicant", "Company", "Type", "Decision", "When"].map((h) => (
                    <th key={h} scope="col" className="text-fg-subtle px-3 py-2 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decided.map((a) => (
                  <tr key={a.id} className="border-line border-b last:border-0">
                    <td className="px-3 py-2">
                      {a.full_name}
                      <span className="text-fg-subtle block">{a.email}</span>
                    </td>
                    <td className="px-3 py-2">{a.company_name}</td>
                    <td className="px-3 py-2">{a.account_type === "partner" ? `Partner · ${kindLabel(a.partner_role)}` : "Enterprise"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={a.status === "active" ? "success" : "destructive"}>{a.status === "active" ? "Approved" : "Rejected"}</Badge>
                      {a.rejection_reason ? <span className="text-fg-subtle mt-1 block">{a.rejection_reason}</span> : null}
                    </td>
                    <td className="text-fg-subtle px-3 py-2 tabular-nums">{a.reviewed_at ? when.format(new Date(a.reviewed_at)) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
