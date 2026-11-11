import { z } from "zod";

/**
 * Concierge requests as stored (concierge_requests): a quote on one listing,
 * or a Plan-an-event brief, worked by hand at /admin/requests. Pure: tests
 * import it.
 */

export const REQUEST_STATUSES = ["new", "working", "options_sent", "booked", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** What the requester sees, and what admins pick from. */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  new: "Sent",
  working: "Working on it",
  options_sent: "Options sent",
  booked: "Booked",
  closed: "Closed",
};

export const isOpenStatus = (s: string) => s === "new" || s === "working";

/** Until it's booked or closed, the company can withdraw a request (Home → Requests). */
export const isWithdrawable = (s: string) => s === "new" || s === "working" || s === "options_sent";

/** The note a withdrawn request carries (shown to the company and in /admin/requests). */
export const WITHDRAWN_NOTE = "Withdrawn by the company";

/** The requester, or an Approver of the company, may withdraw it; Lufer admins too. */
export function mayWithdrawRequest(
  who: { role: string; userId: string; companyId: string | null; corporateRole: string | null },
  request: { company_id: string | null; requested_by: string | null }
): boolean {
  if (who.role === "ADMIN") return true;
  if (who.role !== "CLIENT" || !who.companyId || request.company_id !== who.companyId) return false;
  return who.corporateRole === "APPROVER" || request.requested_by === who.userId;
}

/** Pill tone per status (components/portal/pills.tsx). */
export const REQUEST_STATUS_TONE: Record<RequestStatus, "warn" | "neutral" | "ok"> = {
  new: "warn",
  working: "warn",
  options_sent: "ok",
  booked: "ok",
  closed: "neutral",
};

export const statusOf = (s: string): RequestStatus => ((REQUEST_STATUSES as readonly string[]).includes(s) ? (s as RequestStatus) : "new");

export const RequestUpdate = z.object({
  id: z.uuid(),
  status: z.enum(REQUEST_STATUSES),
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters.")
    .transform((v) => v || null),
});
export type RequestUpdateInput = z.input<typeof RequestUpdate>;
export type RequestUpdate = z.output<typeof RequestUpdate>;

export interface NewConciergeRequest {
  companyId: string | null;
  requestedBy: string | null;
  requesterEmail: string;
  kind: "quote" | "brief";
  partnerVenueId?: string | null;
  venueName?: string | null;
  eventDate?: string | null;
  guests?: number | null;
  perHeadInr?: number | null;
  details?: string | null;
  rfpId?: string | null;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** One line for a request: "Toit, 40 guests, 12 Dec" or the brief's start. */
export function requestSummary(r: { kind: string; venue_name: string | null; guests: number | null; event_date: string | null; details: string | null }): string {
  const parts = [r.kind === "quote" ? (r.venue_name ?? "Quote") : "Event brief", r.guests ? `${r.guests} guests` : null, r.event_date ? shortDate(r.event_date) : null].filter(Boolean);
  if (r.kind === "brief" && !r.guests && !r.event_date && r.details) return `Event brief: ${r.details.length > 60 ? `${r.details.slice(0, 57)}…` : r.details}`;
  return parts.join(", ");
}

/** The instant alert to Lufer's concierge (Telegram): who, what, and where to work it. */
export function conciergeAlertText(r: NewConciergeRequest & { companyName: string }, link: string): string {
  const head = r.kind === "quote" ? `New quote request: ${r.venueName ?? "a venue"}` : "New event brief";
  const lines = [
    head,
    `${r.companyName} · ${r.requesterEmail}`,
    [r.eventDate ? shortDate(r.eventDate) : null, r.guests ? `${r.guests} guests` : null, r.perHeadInr ? `${inr(r.perHeadInr)}/head` : null].filter(Boolean).join(" · "),
    r.details ? (r.details.length > 500 ? `${r.details.slice(0, 497)}…` : r.details) : null,
    link,
  ];
  return lines.filter((l) => l).join("\n");
}
