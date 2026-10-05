"use client";

import { useActionState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideBookingApproval, type ApprovalDecisionState } from "../actions";

export function ApprovalDecisionForm({
  approvalId,
  userId,
  companyId,
}: {
  approvalId: string;
  userId: string;
  companyId: string;
}) {
  const [state, formAction, pending] = useActionState<ApprovalDecisionState, FormData>(decideBookingApproval, {
    status: "idle",
  });

  return (
    <form action={formAction} className="grid gap-2 sm:w-80">
      <input type="hidden" name="approval_id" value={approvalId} />
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="company_id" value={companyId} />
      <Input name="note" placeholder="Comment (optional)" maxLength={500} aria-label="Comment for the requester" />
      <div className="flex gap-2">
        <Button type="submit" name="intent" value="approve" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Approve
        </Button>
        <Button type="submit" name="intent" value="reject" size="sm" variant="outline" disabled={pending}>
          <X aria-hidden /> Reject
        </Button>
      </div>
      {state.status === "error" ? (
        <p className="text-destructive text-xs" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
