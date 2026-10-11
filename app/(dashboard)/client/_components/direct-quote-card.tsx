"use client";

import { useActionState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";

import { bookDirectQuote, type QuoteBookingState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDate, formatINR } from "@/lib/utils";

const IDLE: QuoteBookingState = { status: "idle" };

/**
 * A quote a venue sent this company unasked (rfps.origin = 'venue'): the terms,
 * and for Organizers and Approvers a one-step "Book this quote" at its price.
 * The booking goes through the normal policy, PO and hold checks.
 */
export function DirectQuoteCard({
  responseId,
  venueName,
  neighborhood,
  eventDate,
  partySize,
  perHead,
  packageName,
  invoiceTotal,
  notes,
  status,
  canBook,
}: {
  responseId: string;
  venueName: string;
  neighborhood: string;
  eventDate: string | null;
  partySize: number;
  perHead: number | null;
  packageName: string | null;
  invoiceTotal: number | null;
  notes: string | null;
  /** rfps.status: open quotes can be booked. */
  status: string;
  canBook: boolean;
}) {
  const [state, action, pending] = useActionState(bookDirectQuote, IDLE);
  const booked = status === "awarded" || state.status === "success";
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="label-mono">Venue</dt>
          <dd className="text-fg mt-1">
            {venueName}
            <span className="text-fg-subtle block text-[12px]">{neighborhood}</span>
          </dd>
        </div>
        <div>
          <dt className="label-mono">Date · guests</dt>
          <dd className="text-fg mt-1 tabular-nums">
            {eventDate ? formatDate(eventDate) : "—"} · {partySize}
          </dd>
        </div>
        <div>
          <dt className="label-mono">Per head</dt>
          <dd className="text-fg mt-1 tabular-nums">
            {perHead != null ? formatINR(perHead) : "—"}
            {packageName ? <span className="text-fg-subtle block text-[12px]">{packageName}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="label-mono">Invoice total</dt>
          <dd className="text-fg mt-1 font-medium tabular-nums">{invoiceTotal != null ? formatINR(invoiceTotal, true) : "—"}</dd>
        </div>
      </dl>
      {notes ? <p className="text-fg-muted text-[13px]">“{notes}”</p> : null}

      {booked ? (
        <p role="status" className="text-sage text-[13px]">
          {state.message ?? "Booked: it's in Your bookings."}
        </p>
      ) : status !== "open" ? (
        <p className="text-fg-subtle text-[13px]">This quote is closed.</p>
      ) : canBook ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="response_id" value={responseId} />
          <label className="grid gap-1 text-[12.5px]">
            <span className="text-fg-subtle">Cost centre</span>
            <Input name="cost_center" required maxLength={32} placeholder="ENG-BLR" className="h-8 w-36 font-mono" />
          </label>
          <label className="grid gap-1 text-[12.5px]">
            <span className="text-fg-subtle">Project (optional)</span>
            <Input name="project_code" maxLength={32} className="h-8 w-32 font-mono" />
          </label>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarCheck aria-hidden />} Book this quote
          </Button>
          <p className={cn("w-full text-[12px]", state.status === "error" ? "text-rose" : "text-fg-subtle")} role={state.status === "error" ? "alert" : undefined}>
            {state.status === "error" ? state.message : "Booked at the quoted price, no rate card on top. Your company's policy and POs still apply."}
          </p>
        </form>
      ) : (
        <p className="text-fg-subtle text-[12.5px]">An Organizer or Approver can book this quote.</p>
      )}
    </div>
  );
}
