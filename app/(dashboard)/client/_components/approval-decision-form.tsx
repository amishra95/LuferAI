"use client";

import { useRef } from "react";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useOptimisticMutation } from "@/components/workspace/use-optimistic-mutation";
import { approveEventSpend } from "../actions";

type Decision = "PENDING" | "APPROVED" | "REJECTED";

/**
 * Approve / reject one approval (approveEventSpend). The decision shows at once;
 * if the server refuses (e.g. a tier-2 approver acting before tier 1) it rolls
 * back and a toast says why. Approver and tenant come from the session.
 */
export function ApprovalDecisionForm({ approvalId, className }: { approvalId: string; className?: string }) {
  const { value: decision, mutate, pending } = useOptimisticMutation<Decision>("PENDING");
  const note = useRef<HTMLTextAreaElement>(null);

  function decide(next: "APPROVED" | "REJECTED") {
    void mutate({
      apply: () => next,
      action: () => approveEventSpend(approvalId, next, note.current?.value ?? ""),
      failure: next === "APPROVED" ? "Couldn't approve" : "Couldn't reject",
      success: (r) => ({
        tone: "success",
        title: next === "APPROVED" ? "Approved" : "Rejected",
        description:
          r.bookingStatus === "PENDING"
            ? "Every sign-off is in: the request has gone to the venue."
            : r.bookingStatus === "CANCELLED"
              ? "The booking was cancelled and its date released."
              : next === "APPROVED"
                ? "Waiting on the next approver."
                : undefined,
      }),
    });
  }

  if (decision !== "PENDING") {
    return (
      <div className={className ?? "grid gap-3"} role="status">
        <p className="text-fg flex items-center gap-2 text-sm">
          {decision === "APPROVED" ? <Check className="text-sage size-4" aria-hidden /> : <X className="text-rose size-4" aria-hidden />}
          {decision === "APPROVED" ? "Approved" : "Rejected"}
          {pending && <Loader2 className="text-fg-subtle size-3.5 animate-spin" aria-label="Saving" />}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className={className ?? "grid gap-3"}>
      <div className="grid gap-1.5">
        <Label htmlFor={`note-${approvalId}`}>Note (optional)</Label>
        <textarea
          ref={note}
          id={`note-${approvalId}`}
          name="note"
          rows={2}
          maxLength={500}
          placeholder="Reason for the exception, or what to change"
          className="field-sizing-content min-h-11 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => decide("REJECTED")}>
          <X aria-hidden /> Reject
        </Button>
        <Button type="button" className="min-h-11" onClick={() => decide("APPROVED")}>
          <Check aria-hidden /> Approve
        </Button>
      </div>
    </form>
  );
}
