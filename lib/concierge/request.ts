import { z } from "zod";

/**
 * Concierge requests (Wizard of Oz): a company asks for a venue Lufer lists
 * but doesn't book directly (partner listings), or sends a brief no venue
 * here can quote. Lufer's ops inbox gets the request and arranges it by hand;
 * the requester gets a receipt. Pure: tests import it.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

export const QuoteRequest = z.object({
  venueId: z.uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .refine((d) => d >= todayIso(), "Pick a date from today on."),
  guests: z.coerce.number().int("Whole guests only.").min(2, "At least 2 guests.").max(5000),
  perHead: z.union([z.literal(""), z.coerce.number().int().min(100).max(100_000)]).transform((v) => (v === "" ? null : v)),
  notes: z.string().trim().max(1000),
});

export type QuoteRequestInput = z.input<typeof QuoteRequest>;
export type QuoteRequest = z.output<typeof QuoteRequest>;

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export interface RequestContext {
  companyName: string;
  requesterEmail: string;
}

/** The email to Lufer ops for a quote request on one venue. */
export function opsQuoteEmail(ctx: RequestContext, venue: { name: string; area: string; address: string }, r: QuoteRequest) {
  const subject = `Quote request: ${venue.name}, ${r.guests} guests, ${longDate(r.date)} (${ctx.companyName})`;
  const lines = [
    `${ctx.requesterEmail} at ${ctx.companyName} asked for a quote.`,
    "",
    `Venue: ${venue.name}, ${venue.area}`,
    `Address: ${venue.address}`,
    `Date: ${longDate(r.date)}`,
    `Guests: ${r.guests}`,
    `Budget: ${r.perHead ? `${inr(r.perHead)} per head (pre-GST)` : "not given"}`,
    ...(r.notes ? ["", `Notes: ${r.notes}`] : []),
    "",
    "Reply to this email to reach the requester.",
  ];
  return { subject, lines };
}

/** The email to Lufer ops for a Plan-an-event brief. */
export function opsBriefEmail(ctx: RequestContext, brief: string, venuesQuoted: number) {
  const subject = `Event brief from ${ctx.companyName}${venuesQuoted === 0 ? " (no venue could quote)" : ""}`;
  const lines = [
    `${ctx.requesterEmail} at ${ctx.companyName} sent this brief:`,
    "",
    brief,
    "",
    venuesQuoted === 0 ? "No listed venue could quote it automatically, so it needs the concierge." : `${venuesQuoted} listed venue${venuesQuoted === 1 ? "" : "s"} quoted automatically.`,
    "Reply to this email to reach the requester.",
  ];
  return { subject, lines };
}

/** The receipt to the requester. */
export function requesterReceipt(what: string) {
  const subject = "We've got your request";
  const lines = [`Thanks. We've got your request for ${what}.`, "", "The Lufer team will come back to you with options and prices, usually within a working day.", "", "— Lufer"];
  return { subject, lines };
}
