"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { cancelBookingAction } from "@/app/(dashboard)/client/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/workspace/use-optimistic-mutation";
import type { CancelMode } from "@/lib/bookings/cancellation";

/**
 * Cancel an event (lib/bookings/cancellation.ts). "cancel": before the venue
 * confirms, it ends at once. "request": after it confirms, Lufer is asked and
 * settles the refund under the venue's terms. Asks once before acting.
 */
export function CancelEvent({
  bookingId,
  mode,
  refund,
  terms,
  requestedOn,
  admin,
}: {
  bookingId: string;
  mode: CancelMode;
  /** "request" only: what cancelling today refunds, as one line. */
  refund: string | null;
  /** "request" only: the venue's tiers, as one line. */
  terms: string | null;
  /** Set once a cancellation was requested (shown instead of the button). */
  requestedOn: string | null;
  admin: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const act = useAction<{ mode: CancelMode; refund?: string }>();
  const router = useRouter();

  if (requestedOn && !admin) {
    return (
      <p role="status" className="text-fg text-meta">
        Cancellation requested on {requestedOn}. Lufer will confirm the refund with you.
      </p>
    );
  }

  const label = mode === "cancel" ? (admin ? "Cancel booking" : "Cancel request") : "Request cancellation";
  const submit = async () => {
    const outcome = await act.run(() => cancelBookingAction({ bookingId, reason }), {
      failure: mode === "cancel" ? "Couldn't cancel" : "Couldn't request cancellation",
      success: (r) =>
        r.mode === "cancel"
          ? { tone: "success", title: "Cancelled", description: "The date is released and any deposit hold is returned in full." }
          : { tone: "success", title: "Cancellation requested", description: "Lufer will confirm with the venue and settle the refund." },
    });
    if (outcome?.ok) {
      setConfirming(false);
      router.refresh();
    }
  };

  return (
    <div className="grid gap-3">
      {requestedOn ? <p className="text-fg text-meta">The company asked to cancel on {requestedOn}. Refund any captured deposit in Razorpay first.</p> : null}
      {mode === "request" ? (
        <dl className="grid gap-2 text-meta">
          <div>
            <dt className="text-fg-subtle">Refund if cancelled today</dt>
            <dd className="text-fg">{refund}</dd>
          </div>
          {terms ? (
            <div>
              <dt className="text-fg-subtle">Venue terms</dt>
              <dd className="text-fg">{terms}</dd>
            </div>
          ) : null}
        </dl>
      ) : requestedOn ? null : (
        <p className="text-fg-subtle text-meta">{admin ? "Any deposit hold is released. Refund a captured deposit in Razorpay first." : "The date is released and any deposit hold is returned in full."}</p>
      )}

      {confirming ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`cancel-reason-${bookingId}`}>Reason</Label>
            <textarea
              id={`cancel-reason-${bookingId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="field-sizing-content min-h-11 resize-none rounded-md border border-line bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming(false)} disabled={act.pending}>
              Keep event
            </Button>
            <Button type="submit" variant="destructive" className="min-h-11 sm:min-h-9" disabled={act.pending}>
              {act.pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {label}
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" className="min-h-11 w-full sm:min-h-9" onClick={() => setConfirming(true)}>
          {label}
        </Button>
      )}
    </div>
  );
}
