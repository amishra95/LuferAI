import { z } from "zod";

/**
 * Concierge requests as stored (concierge_requests): a quote on one listing,
 * or a Plan-an-event brief, worked by hand at /admin/requests. Pure: tests
 * import it.
 */

export const REQUEST_STATUSES = ["new", "working", "options_sent", "quoted", "booked", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** What the requester sees, and what admins pick from. */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  new: "Sent",
  working: "Working on it",
  options_sent: "Options sent",
  quoted: "Quote sent",
  booked: "Booked",
  closed: "Closed",
};

export const isOpenStatus = (s: string) => s === "new" || s === "working";

/** Until it's booked or closed, the company can withdraw a request (Home → Requests). */
export const isWithdrawable = (s: string) => s === "new" || s === "working" || s === "options_sent" || s === "quoted";

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
  quoted: "warn",
  booked: "ok",
  closed: "neutral",
};

export const statusOf = (s: string): RequestStatus => ((REQUEST_STATUSES as readonly string[]).includes(s) ? (s as RequestStatus) : "new");

/** Statuses an admin sets by hand; "quoted" comes only from sending a quote (QuoteInput). */
export const MANUAL_STATUSES = REQUEST_STATUSES.filter((s) => s !== "quoted");

export const RequestUpdate = z.object({
  id: z.uuid(),
  status: z.enum(REQUEST_STATUSES).refine((s) => s !== "quoted", "Send a quote to mark a request as quoted."),
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

// ----------------------------------------------------------------------------
// Quotes: Lufer answers a request with a price; the company accepts and pays
// ----------------------------------------------------------------------------

/**
 * The quote Lufer sends for the venue (migration 20261119000000): what is
 * being bought and the one total the company pays, every tax and charge
 * included. The request's venue, date and guests are confirmed or corrected
 * with it, since the quote is for exactly those.
 */
export const QuoteInput = z.object({
  id: z.uuid(),
  venueName: z.string().trim().min(2, "Name the venue.").max(200),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the event date."),
  guests: z.number().int("Guests is a whole number.").min(1, "Enter the number of guests.").max(100_000),
  totalInr: z
    .number()
    .min(1, "Enter the total the company pays.")
    .max(100_000_000, "That total is too large.")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Two decimal places at most."),
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters.")
    .optional()
    .transform((v) => v || null),
});
export type QuoteInput = z.input<typeof QuoteInput>;
export type Quote = z.output<typeof QuoteInput>;

/** A quote can be sent, or sent again with a new price, until the company accepts or the request closes. */
export const isQuotable = (s: string) => s === "new" || s === "working" || s === "options_sent" || s === "quoted";

type Who = { role: string; userId: string; companyId: string | null; corporateRole: string | null };
type QuotedRequest = { company_id: string | null; requested_by: string | null; status: string; quote_total_inr: number | null };

/** The requester, or an Approver of the company, accepts a quote. Lufer admins don't: it's the company's decision. */
export function mayAcceptQuote(who: Who, request: Pick<QuotedRequest, "company_id" | "requested_by">): boolean {
  if (who.role !== "CLIENT" || !who.companyId || request.company_id !== who.companyId) return false;
  return who.corporateRole === "APPROVER" || request.requested_by === who.userId;
}

/** Why a member can't accept a request's quote, in words for the action's error (null: they can). */
export function acceptRefusal(who: Who, request: QuotedRequest): string | null {
  if (who.role === "ADMIN") return "The company accepts its own quote.";
  if (!mayAcceptQuote(who, request)) return "Only the person who sent this request, or an Approver, can accept the quote.";
  if (request.status === "booked") return "This quote was already accepted.";
  if (request.status !== "quoted" || request.quote_total_inr == null) return "There is no open quote on this request.";
  return null;
}

/** An accepted quote is payable until it's paid: anyone at the company who can request events may pay it. */
export const isPayableRequest = (r: { status: string; quote_total_inr: number | null; accepted_at: string | null }) =>
  r.status === "booked" && r.quote_total_inr != null && r.accepted_at != null;

/** "₹94,400", or "₹59,000.50" when there are paise (never "₹59,000.5"). */
export const inr2 = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** "₹94,400 for 40 guests (₹2,360 a head)": the quote in one line. */
export function quoteLine(r: { quote_total_inr: number | null; guests: number | null }): string | null {
  if (r.quote_total_inr == null) return null;
  const total = Number(r.quote_total_inr);
  if (!r.guests) return inr2(total);
  return `${inr2(total)} for ${r.guests} guests (${inr2(Math.round(total / r.guests))} a head)`;
}

type QuoteFacts = { venue_name: string | null; event_date: string | null; guests: number | null; quote_total_inr: number | null; quote_note: string | null };

/** Email to the requester: the quote is in, accept it in the app. */
export function quoteEmail(r: QuoteFacts, link: string): { subject: string; lines: string[] } {
  const venue = r.venue_name ?? "your venue";
  return {
    subject: `Your quote for ${venue}${r.event_date ? `, ${shortDate(r.event_date)}` : ""}`,
    lines: [
      `${venue} can host your event${r.event_date ? ` on ${shortDate(r.event_date)}` : ""}.`,
      "",
      `Total: ${quoteLine(r) ?? ""}, all taxes and charges included.`,
      ...(r.quote_note ? [r.quote_note] : []),
      "",
      `Accept the quote in Lufer: ${link}`,
    ],
  };
}

/** Message to Lufer ops when the company accepts (email and Telegram): confirm with the venue. */
export function acceptedAlert(r: QuoteFacts, who: { companyName: string; email: string }): { subject: string; lines: string[] } {
  return {
    subject: `Quote accepted: ${who.companyName} at ${r.venue_name ?? "a venue"}${r.event_date ? `, ${shortDate(r.event_date)}` : ""}`,
    lines: [
      `${who.email} at ${who.companyName} accepted the quote.`,
      "",
      `${r.venue_name ?? "Venue"} · ${r.event_date ? shortDate(r.event_date) : "date open"} · ${r.guests ?? "?"} guests`,
      `Total: ${quoteLine(r) ?? ""}`,
      "",
      "Next: confirm the booking with the venue. The company can pay the total in Lufer from now on.",
    ],
  };
}

/** Message to Lufer ops when the company pays an accepted quote. */
export function paidAlert(r: QuoteFacts, who: { companyName: string }, paymentRef: string | null): { subject: string; lines: string[] } {
  return {
    subject: `Paid: ${who.companyName} at ${r.venue_name ?? "a venue"}${r.event_date ? `, ${shortDate(r.event_date)}` : ""}`,
    lines: [`${who.companyName} paid ${r.quote_total_inr != null ? inr2(Number(r.quote_total_inr)) : "the quote"} for ${r.venue_name ?? "the venue"}.`, ...(paymentRef ? [`Payment ${paymentRef}`] : []), "", "Next: settle with the venue."],
  };
}
