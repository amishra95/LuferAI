import { z } from "zod";

import { formatINR } from "../utils.ts";
import { describeCancellation, refundFor, type CancellationTier } from "../venues/profile.ts";

/**
 * Cancelling an event from the company side (Refund Policy, /refunds):
 *
 * - Before the venue confirms (PENDING_APPROVAL, PENDING): "cancel". The
 *   booking is cancelled at once, its date hold released and any deposit
 *   authorisation voided in full.
 * - After the venue confirms (CONFIRMED, event not yet past): "request". The
 *   booking stays confirmed; Lufer and the venue are emailed, and Lufer
 *   settles the refund the venue's terms give for the notice, by hand.
 * - Otherwise (completed, settled, cancelled, or a confirmed event whose date
 *   has passed): nothing to cancel.
 *
 * The requester (bookings.requested_by) and any Approver of the company may
 * cancel; Finance viewers can't. Lufer admins may too, and for them a confirmed
 * booking cancels outright: that's how ops close one once the refund is
 * settled. Pure: tests import it.
 */

export type CancelMode = "cancel" | "request";

export function cancelModeFor(booking: { status: string; event_date: string }, today: string, opts: { admin?: boolean } = {}): CancelMode | null {
  if (booking.status === "PENDING_APPROVAL" || booking.status === "PENDING") return "cancel";
  if (booking.status === "CONFIRMED" && opts.admin) return "cancel";
  if (booking.status === "CONFIRMED" && booking.event_date >= today) return "request";
  return null;
}

export interface Canceller {
  role: string;
  userId: string;
  companyId: string | null;
  corporateRole: string | null;
}

export function mayCancel(who: Canceller, booking: { company_id: string; requested_by: string | null }): boolean {
  if (who.role === "ADMIN") return true;
  if (who.role !== "CLIENT" || !who.companyId || who.companyId !== booking.company_id) return false;
  if (who.corporateRole === "APPROVER") return true;
  return who.corporateRole === "ORGANIZER" && booking.requested_by === who.userId;
}

/** Why a member can't cancel, for the action's error (null: they can). */
export function cancelRefusal(who: Canceller, booking: { company_id: string; requested_by: string | null; status: string; event_date: string; cancellation_requested_at?: string | null }, today: string): string | null {
  if (!mayCancel(who, booking)) return "Only the person who requested this event, or an Approver, can cancel it.";
  const mode = cancelModeFor(booking, today, { admin: who.role === "ADMIN" });
  if (!mode) return booking.status === "CANCELLED" ? "This event is already cancelled." : "This event can no longer be cancelled here. Email support with the booking reference.";
  if (mode === "request" && booking.cancellation_requested_at) return "Cancellation was already requested. Lufer will be in touch.";
  return null;
}

export const CancelInput = z.object({
  bookingId: z.uuid(),
  reason: z
    .string()
    .trim()
    .max(500, "Keep the reason under 500 characters.")
    .optional()
    .transform((v) => v || null),
});
export type CancelInput = z.input<typeof CancelInput>;

/** What cancelling a confirmed booking now would refund under the venue's terms. */
export function refundEstimate(terms: CancellationTier[], booking: { event_date: string; total_amount_inr: number }, today: string) {
  const { refundPct, refund } = refundFor(terms, booking.event_date, today, booking.total_amount_inr);
  return { known: terms.length > 0, refundPct, refund, terms: describeCancellation(terms) };
}

/** One line for the UI and emails: "₹45,000 (50%) under the venue's terms" or "Set by the venue's terms". */
export function refundLine(estimate: ReturnType<typeof refundEstimate>): string {
  if (!estimate.known) return "Set by the venue's terms; Lufer will confirm the amount.";
  if (estimate.refundPct === 0) return "No refund at this notice under the venue's terms.";
  return `${formatINR(estimate.refund)} (${estimate.refundPct}%) under the venue's terms.`;
}

export interface CancellationNotice {
  kind: CancelMode;
  reference: string;
  venueName: string;
  companyName: string;
  eventDate: string;
  guests: number;
  total: number;
  by: string;
  reason: string | null;
  refund: string | null;
}

/** The booking reference companies quote to support: the first 8 characters of the id, upper case. */
export const bookingReference = (id: string) => id.slice(0, 8).toUpperCase();

/** Email to the venue (or the concierge inbox for venues without a manager). */
export function venueCancellationEmail(n: CancellationNotice): { subject: string; lines: string[] } {
  const head =
    n.kind === "cancel"
      ? `${n.companyName} has cancelled their request for ${n.eventDate} before it was confirmed. The date is free again.`
      : `${n.companyName} has asked to cancel their confirmed booking for ${n.eventDate}. Lufer will contact you to settle it under your cancellation terms.`;
  return {
    subject: n.kind === "cancel" ? `Request cancelled: ${n.companyName}, ${n.eventDate}` : `Cancellation requested: ${n.companyName}, ${n.eventDate}`,
    lines: [head, "", `Booking ${n.reference}`, `Guests: ${n.guests}`, `Total: ${formatINR(n.total)}`, ...(n.reason ? [`Reason: ${n.reason}`] : [])],
  };
}

/** Email to Lufer ops (CONCIERGE_EMAIL): a confirmed booking needs a refund settled by hand. */
export function opsCancellationEmail(n: CancellationNotice): { subject: string; lines: string[] } {
  return {
    subject: `Cancellation requested: ${n.companyName} at ${n.venueName}, ${n.eventDate}`,
    lines: [
      `${n.by} at ${n.companyName} asked to cancel a confirmed booking.`,
      "",
      `Booking ${n.reference}`,
      `Venue: ${n.venueName}`,
      `Date: ${n.eventDate}`,
      `Guests: ${n.guests}`,
      `Total: ${formatINR(n.total)}`,
      `Refund due: ${n.refund ?? "check the venue's terms"}`,
      ...(n.reason ? [`Reason: ${n.reason}`] : []),
      "",
      "Next: confirm with the venue, refund through Razorpay, then open the event as admin and choose Cancel booking.",
    ],
  };
}
