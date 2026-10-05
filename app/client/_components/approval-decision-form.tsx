"use client";

import { useActionState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { decideBookingApproval, type ApprovalDecisionState } from "../actions";

/** Approve / reject one approval. Approver and tenant come from the session server-side. */
export function ApprovalDecisionForm({ approvalId, className }: { approvalId: string; className?: string }) {
  const [state, formAction, pending] = useActionState<ApprovalDecisionState, FormData>(decideBookingApproval, {
    status: "idle",
  });

  return (
    <form action={formAction} className={className ?? "grid gap-3"}>
      <input type="hidden" name="approval_id" value={approvalId} />
      <div className="grid gap-1.5">
        <Label htmlFor={`note-${approvalId}`}>Note (optional)</Label>
        <textarea
          id={`note-${approvalId}`}
          name="note"
          rows={2}
          maxLength={500}
          placeholder="Reason for the exception, or what to change"
          className="field-sizing-content min-h-11 resize-none rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="submit" name="intent" value="reject" variant="outline" className="min-h-11" disabled={pending}>
          <X aria-hidden /> Reject
        </Button>
        <Button type="submit" name="intent" value="approve" className="min-h-11" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Approve
        </Button>
      </div>
      {state.status === "error" ? (
        <p className="text-xs text-red-300" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
