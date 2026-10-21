"use client";

import { CircleCheck, Loader2, TrendingUp } from "lucide-react";

import { approvalCommandAction } from "@/app/(dashboard)/governance/actions";
import { SectionLabel } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/portal/empty-state";
import { Pill, type PillTone } from "@/components/portal/pills";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import { isOverdue, type StepProgress } from "@/lib/services/enterprise/approvalEngine";
import type { ApprovalRequestView } from "@/lib/services/enterprise/governanceStore";
import { cn, formatDate, formatINR } from "@/lib/utils";

const STATE: Record<StepProgress["state"], { label: string; tone: PillTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  waiting: { label: "Deciding", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Rejected", tone: "error" },
};

const OUTCOME: Record<ApprovalRequestView["outcome"], { label: string; tone: PillTone }> = {
  pending: { label: "In progress", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Rejected", tone: "error" },
};

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Step({ s, companyId, canEscalate, now }: { s: ApprovalRequestView["steps"][number]; companyId: string | null; canEscalate: boolean; now: Date }) {
  const act = useAction<unknown>();
  const overdue = isOverdue(s.approval, now);
  const escalate = () =>
    act.run(() => approvalCommandAction(companyId, { action: "escalate", approvalId: s.approval.id, reason: overdue ? undefined : "Escalated by hand from Governance" }), {
      failure: "Couldn't escalate",
      success: () => ({ tone: "success", title: `Step ${s.step} escalated`, description: "The next tier up has it now." }),
    });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span className="figure text-fg-subtle w-12 shrink-0 text-caption">Step {s.step}</span>
      <span className="text-fg min-w-0 text-meta">{s.approverName}</span>
      {s.escalatedFromNames.length ? <span className="text-fg-faint text-caption">escalated from {s.escalatedFromNames.join(", then ")}</span> : null}
      <Pill tone={overdue ? "error" : STATE[s.state].tone}>{overdue ? "Past deadline" : STATE[s.state].label}</Pill>
      {s.state === "waiting" && s.approval.due_at ? (
        <span className={cn("figure text-caption", overdue ? "text-rose" : "text-fg-subtle")}>due {when(s.approval.due_at)}</span>
      ) : null}
      {canEscalate && s.state === "waiting" ? (
        <button type="button" className="btn btn-ghost ml-auto h-7 px-2 text-caption" disabled={act.pending} onClick={escalate}>
          {act.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <TrendingUp className="size-3.5" aria-hidden />}
          Escalate
        </button>
      ) : null}
    </li>
  );
}

function Request({ r, companyId, canEscalate, now }: { r: ApprovalRequestView; companyId: string | null; canEscalate: boolean; now: Date }) {
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-fg text-body font-medium">{r.booking.venue_name}</span>
        <span className="text-fg-subtle text-caption">
          {r.booking.event_date ? `${formatDate(r.booking.event_date)} · ` : ""}
          {r.booking.party_size} {r.subject === "order" ? "units" : "guests"} · requested by {r.requesterName}
        </span>
        <span className="figure text-fg ml-auto text-meta">{formatINR(r.booking.total_amount_inr)}</span>
        <Pill tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Pill>
      </div>
      {r.reason ? <p className="text-fg-subtle text-caption leading-5">{r.reason}</p> : null}
      <ol className="border-line border-l pl-3" aria-label="Sign-off steps">
        {r.steps.map((s) => (
          <Step key={s.approval.id} s={s} companyId={companyId} canEscalate={canEscalate && r.outcome === "pending"} now={now} />
        ))}
      </ol>
    </li>
  );
}

/** Approval requests and where each one is in its sequence. Approvers decide on /client/approvals. */
export function RequestBoard({
  companyId,
  pending,
  recent,
  canEscalate,
  now,
}: {
  companyId: string | null;
  pending: ApprovalRequestView[];
  recent: ApprovalRequestView[];
  canEscalate: boolean;
  now: string;
}) {
  const at = new Date(now);
  return (
    <section aria-labelledby="requests-heading" className="mt-10">
      <SectionLabel>
        <span id="requests-heading">Approval requests</span>
      </SectionLabel>
      {pending.length === 0 ? (
        <EmptyState icon={CircleCheck} compact title="Nothing waiting for sign-off" description="Requests that need approval show here with each step's approver, deadline and escalations." />
      ) : (
        <ul className="panel divide-line divide-y">
          {pending.map((r) => (
            <Request key={r.subjectId} r={r} companyId={companyId} canEscalate={canEscalate} now={at} />
          ))}
        </ul>
      )}
      {recent.length ? (
        <>
          <h3 className="label-mono mt-6 mb-3">Recently decided</h3>
          <ul className="panel divide-line divide-y">
            {recent.map((r) => (
              <Request key={r.subjectId} r={r} companyId={companyId} canEscalate={false} now={at} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
