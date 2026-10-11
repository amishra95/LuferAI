import { CheckCheck, ClipboardCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { planStatus, venueAckBlocker, type EventPlan } from "@/lib/events/plan";
import { formatINR } from "@/lib/utils";
import { acknowledgePlanAction } from "../actions";

/**
 * The client's event plan as the venue sees it, under each event brief: the
 * run of show, catering and requirements once signed off, and "Confirm plan"
 * so the client knows the venue has it (lib/events/plan.ts).
 */
export function PlanAck({ plan, bookingId, venueId, cateringPackage }: { plan: EventPlan; bookingId: string; venueId: string; cateringPackage: { name: string; per_head_inr: number } | null }) {
  const status = planStatus(plan);
  if (status.stage === "empty") return null;
  if (status.stage !== "approved") {
    return (
      <p className="text-fg-subtle flex items-center gap-2 text-[12.5px]">
        <ClipboardCheck className="size-3.5" aria-hidden /> The client is preparing their event plan; you&apos;ll see it here once an Approver signs it off.
      </p>
    );
  }
  const blocked = venueAckBlocker(plan);
  return (
    <div className="border-line grid gap-3 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-mono">Client&apos;s event plan</span>
        <Badge variant={status.venueAcknowledged ? "success" : "warning"}>{status.venueAcknowledged ? "Confirmed by you" : "Signed off · awaiting your confirmation"}</Badge>
      </div>
      {plan.runOfShow.length ? (
        <ol className="grid gap-1 text-[13px]" aria-label="Run of show">
          {plan.runOfShow.map((i, n) => (
            <li key={n} className="flex gap-3">
              <span className="text-fg-subtle w-12 shrink-0 font-mono tabular-nums">{i.time}</span>
              <span>{i.item}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="text-[13px]">
        <span className="text-fg-subtle">Catering: </span>
        {cateringPackage ? `${cateringPackage.name} · ${formatINR(cateringPackage.per_head_inr)} a head` : "no package chosen"}
      </p>
      {plan.specialRequirements ? <p className="text-[13px] whitespace-pre-wrap">{plan.specialRequirements}</p> : null}
      {blocked === null ? (
        <form action={acknowledgePlanAction}>
          <input type="hidden" name="booking_id" value={bookingId} />
          <input type="hidden" name="venue_id" value={venueId} />
          <input type="hidden" name="revision" value={plan.approvedRevision ?? ""} />
          <Button type="submit" size="sm">
            <CheckCheck aria-hidden /> Confirm plan
          </Button>
        </form>
      ) : null}
    </div>
  );
}
