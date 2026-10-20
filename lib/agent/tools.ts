import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { searchVenueCatalogue } from "@/lib/ai/chat-tools";
import { venueSearchSchema } from "@/lib/ai/venue-sourcing";
import type { Member } from "@/lib/auth/session";
import { googleFreeBusy, isGoogleCalendarConfigured, type BusyInterval } from "@/lib/agent/connectors/google-calendar";
import { queryInventory } from "@/lib/agent/connectors/reservation-inventory";
import { sendWhatsAppMessage, whatsAppProvider } from "@/lib/agent/connectors/whatsapp";
import { createEnterpriseTools, needsApproval, type NeedsApproval } from "@/lib/agent/enterprise-tools";
import { createMemoryTools, type MemoryClient } from "@/lib/agent/memory";
import { listBookings } from "@/lib/data";
import { checkHoldAvailability } from "@/lib/inventory/checkHoldAvailability";
import type { DepositCheckout } from "@/lib/payments/gateways";
import { createDepositCheckout, createInvoiceCheckout, PaymentError } from "@/lib/payments/service";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// ----------------------------------------------------------------------------
// Team availability: Google Calendar free/busy, else a mock calendar
// ----------------------------------------------------------------------------

const DAY_START = 9 * 60; // 09:00 IST
const DAY_END = 22 * 60; // 22:00 IST
const BLOCK = 30;

/** Stable 32-bit hash, so the same person on the same date is always busy at the same times. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Mock free/busy per 30-minute block for one attendee: roughly a third of working blocks are busy. */
function mockBusyBlocks(attendee: string, date: string): Set<number> {
  const busy = new Set<number>();
  for (let t = DAY_START; t < DAY_END; t += BLOCK) {
    // Evenings are mostly free: that's when team events happen.
    const odds = t >= 18 * 60 ? 8 : 3;
    if (hash(`${attendee.toLowerCase()}|${date}|${t}`) % odds === 0) busy.add(t);
  }
  return busy;
}

/** Epoch ms of minute `t` (from IST midnight) on `date`. */
const istMs = (date: string, t: number) => Date.parse(`${date}T00:00:00+05:30`) + t * 60_000;

/** The 30-minute blocks of `date` that overlap any busy interval. */
function blocksFromIntervals(date: string, busy: BusyInterval[]): Set<number> {
  const ranges = busy.map((i) => [Date.parse(i.start), Date.parse(i.end)] as const);
  const blocks = new Set<number>();
  for (let t = DAY_START; t < DAY_END; t += BLOCK) {
    const [s, e] = [istMs(date, t), istMs(date, t + BLOCK)];
    if (ranges.some(([bs, be]) => bs < e && be > s)) blocks.add(t);
  }
  return blocks;
}

export interface AvailabilityQuery {
  date: string;
  attendees: string[];
  durationMinutes: number;
  earliest?: string | null;
  latest?: string | null;
}

type Slot = { start: string; end: string; available: string[]; unavailable: string[] };

export interface TeamAvailability {
  /** "mock": Google Calendar isn't configured and the slots are simulated. */
  source: "google" | "mock";
  date: string;
  timezone: "Asia/Kolkata";
  durationMinutes: number;
  /** Attendees left out of the slot search, and why. */
  unreadCalendars: { attendee: string; reason: string }[];
  allFreeSlots: Slot[];
  bestPartialSlots: Slot[];
}

/** Slots on the date ranked by how many attendees are free, from each attendee's busy blocks. */
function findSlots(input: AvailabilityQuery, calendars: { attendee: string; busy: Set<number> }[]): Pick<TeamAvailability, "allFreeSlots" | "bestPartialSlots"> {
  const toMin = (s: string | null | undefined, fallback: number) => {
    if (!s) return fallback;
    const [h, m] = s.split(":").map(Number);
    return Math.min(DAY_END, Math.max(DAY_START, h * 60 + (m || 0)));
  };
  const from = toMin(input.earliest, DAY_START);
  const to = toMin(input.latest, DAY_END);
  const names = calendars.map((c) => c.attendee);
  const blocksNeeded = Math.ceil(input.durationMinutes / BLOCK);

  const slots: Slot[] = [];
  for (let t = from; t + blocksNeeded * BLOCK <= to; t += BLOCK) {
    const span = Array.from({ length: blocksNeeded }, (_, i) => t + i * BLOCK);
    const available = calendars.filter((c) => span.every((b) => !c.busy.has(b))).map((c) => c.attendee);
    slots.push({ start: hhmm(t), end: hhmm(t + blocksNeeded * BLOCK), available, unavailable: names.filter((a) => !available.includes(a)) });
  }
  // Best first: most attendees free, then earliest.
  slots.sort((a, b) => b.available.length - a.available.length);
  const everyone = slots.filter((s) => s.unavailable.length === 0);
  return { allFreeSlots: everyone.slice(0, 5), bestPartialSlots: everyone.length ? [] : slots.slice(0, 3) };
}

/**
 * Mock team calendar: deterministic free/busy per attendee and date, so a demo
 * conversation gives the same answer twice. Used when Google Calendar isn't configured.
 */
export function mockTeamAvailability(input: AvailabilityQuery): TeamAvailability {
  const calendars = input.attendees.map((a) => ({ attendee: a, busy: mockBusyBlocks(a, input.date) }));
  return { source: "mock", date: input.date, timezone: "Asia/Kolkata", durationMinutes: input.durationMinutes, unreadCalendars: [], ...findSlots(input, calendars) };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Free/busy from Google Calendar. Attendees must be calendar emails; unreadable calendars are reported, not guessed. */
async function googleTeamAvailability(input: AvailabilityQuery): Promise<TeamAvailability> {
  const emails = input.attendees.filter((a) => EMAIL.test(a));
  const unread: { attendee: string; reason: string }[] = input.attendees.filter((a) => !EMAIL.test(a)).map((attendee) => ({ attendee, reason: "not an email address" }));
  const freeBusy = emails.length ? await googleFreeBusy(emails, new Date(istMs(input.date, DAY_START)).toISOString(), new Date(istMs(input.date, DAY_END)).toISOString()) : {};
  const calendars: { attendee: string; busy: Set<number> }[] = [];
  for (const email of emails) {
    const cal = freeBusy[email];
    if (!cal || "error" in cal) unread.push({ attendee: email, reason: cal?.error ?? "not returned" });
    else calendars.push({ attendee: email, busy: blocksFromIntervals(input.date, cal.busy) });
  }
  return { source: "google", date: input.date, timezone: "Asia/Kolkata", durationMinutes: input.durationMinutes, unreadCalendars: unread, ...findSlots(input, calendars) };
}

type PaymentResult =
  /** amountInr is what this checkout charges (null for a Stripe instalment, whose amount stays on Stripe's page). */
  | { ok: true; kind: "deposit" | "instalment"; amountInr: number | null; invoiceTotalInr: number; checkout: DepositCheckout }
  | { ok: false; error: string }
  | NeedsApproval;

/** Deposit or instalment checkout through lib/payments/service.ts, which re-checks the member owns the booking. */
async function createPayment({ bookingId, invoiceId }: { bookingId?: string | null; invoiceId?: string | null }, member: Member, origin: string): Promise<PaymentResult> {
  if (member.role !== "CLIENT" && member.role !== "ADMIN") return { ok: false, error: "Only client and admin users can take payments." };
  if (!bookingId === !invoiceId) return { ok: false, error: "Give exactly one of bookingId or invoiceId." };
  try {
    if (invoiceId) {
      const { checkout, invoice } = await createInvoiceCheckout(invoiceId, member, origin);
      // `invoice` is the whole booking's GST invoice; the instalment's own amount is what the checkout charges.
      const amountInr = checkout.provider === "razorpay" ? checkout.amountPaise / 100 : null;
      return { ok: true, kind: "instalment", amountInr, invoiceTotalInr: invoice.invoice_total, checkout };
    }
    // Policy breaches hold the booking at PENDING_APPROVAL: no money moves until the chain signs off.
    const [booking] = await listBookings({ ids: [bookingId!] });
    if (booking?.status === "PENDING_APPROVAL" && (member.role === "ADMIN" || booking.company_id === member.companyId)) return needsApproval(booking.id);
    const { checkout, invoice } = await createDepositCheckout(bookingId!, member, origin);
    return { ok: true, kind: "deposit", amountInr: invoice.deposit_amount, invoiceTotalInr: invoice.invoice_total, checkout };
  } catch (err) {
    if (err instanceof PaymentError) return { ok: false, error: err.message };
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Tools
// ----------------------------------------------------------------------------

/**
 * Tools for the LuferAI Concierge (/api/agent/chat), bound to the signed-in
 * member. The member and origin come from the session and request, never from
 * the model, so a prompt can't pay another company's invoice: the payments
 * service checks ownership again on every call.
 */
export function createConciergeTools({ member, origin, memory }: { member: Member; origin: string; memory: MemoryClient | null }) {
  return {
    // Memory needs the live database; without it the concierge simply doesn't remember.
    ...(memory ? createMemoryTools(memory, member.userId) : {}),
    ...createEnterpriseTools({ member, origin }),
    checkGoogleCalendarAvailability: tool({
      description:
        "Find time slots on a date when the given people are all free (IST, 09:00–22:00), from their Google Calendar free/busy. " +
        "Pass calendar email addresses. Returns up to 5 slots where everyone is free, or the best partial slots, and lists calendars it couldn't read. " +
        "source \"mock\" means Google Calendar isn't connected and the slots are simulated: say so.",
      inputSchema: z.object({
        date: isoDate.describe("Event date, YYYY-MM-DD."),
        attendees: z.array(z.string().trim().min(1).max(120)).min(1).max(50).describe("Attendees' calendar email addresses (names only work with the mock calendar)."),
        durationMinutes: z.number().int().min(30).max(480).describe("How long the event runs, in minutes."),
        earliest: z.string().regex(/^\d{2}:\d{2}$/).nullish().describe("Earliest start, HH:MM (24h). Omit for 09:00."),
        latest: z.string().regex(/^\d{2}:\d{2}$/).nullish().describe("Latest end, HH:MM (24h). Omit for 22:00."),
      }),
      execute: async (input): Promise<TeamAvailability> => (isGoogleCalendarConfigured() ? googleTeamAvailability(input) : mockTeamAvailability(input)),
    }),

    searchVenues: tool({
      description:
        "Search Bengaluru restaurants and event venues by location, guest count, per-head budget (INR, pre-GST) and features. " +
        "Pass eventDate to also check each bookable venue's availability that day. Returns up to 6 matches with estimated cost. " +
        "The directory has no guest ratings: never state one.",
      inputSchema: venueSearchSchema.extend({
        eventDate: isoDate.nullish().describe("Event date, YYYY-MM-DD, to check availability. Omit if no date is known yet."),
      }),
      execute: async ({ eventDate, ...filters }) => {
        const result = await searchVenueCatalogue(filters);
        if (!eventDate) return { ...result, eventDate: null, venues: result.venues.map((v) => ({ ...v, availableOnDate: null })) };
        const venues = await Promise.all(
          result.venues.map(async (v) => {
            // Partner listings are held by their supplier, so their calendars aren't ours to check.
            if (v.tier !== "internal") return { ...v, availableOnDate: null };
            const availability = await checkHoldAvailability({ venue_id: v.id, from: eventDate, to: eventDate }).catch(() => null);
            return { ...v, availableOnDate: availability ? availability.available : null };
          })
        );
        return { ...result, eventDate, venues };
      },
    }),

    queryReservationInventory: tool({
      description:
        "Day-by-day reservation availability for one venue (an id from searchVenues) over up to 31 days. " +
        "Own venues report holds, bookings and blocked dates; partner venues ask their supplier's inventory API when one is connected.",
      inputSchema: z.object({
        venueId: z.string().trim().min(1).max(80).describe("The venue's id from searchVenues."),
        from: isoDate,
        to: isoDate.describe("Last date to check (inclusive), at most 31 days after `from`."),
        partySize: z.number().int().min(1).max(5000),
      }),
      execute: async (input) => {
        const days = (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000;
        if (!(days >= 0 && days <= 31)) return { status: "invalid" as const, message: "`to` must be on or after `from`, within 31 days." };
        return queryInventory(input);
      },
    }),

    sendWhatsAppConfirmation: tool({
      description:
        "Send a booking summary to a phone number on WhatsApp. The user approves the exact message before it's sent. " +
        "Use only after the user asks for a confirmation to be sent, with the details they've agreed.",
      inputSchema: z.object({
        to: z.string().regex(/^\+[1-9]\d{7,14}$/).describe("Recipient in E.164 format, e.g. +919876543210."),
        summary: z.string().trim().min(10).max(1000).describe("The message: venue, date, time, guests, and anything the guest must know."),
      }),
      execute: async ({ to, summary }) => {
        if (!whatsAppProvider()) return { ok: false as const, error: "WhatsApp isn't configured for this environment." };
        try {
          return { ok: true as const, ...(await sendWhatsAppMessage(to, `LuferAI booking update\n\n${summary}`)) };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : "Send failed" };
        }
      },
    }),

    createInvoiceAndPayment: tool({
      description:
        "Create a GST invoice and payment checkout through the platform's Razorpay pipeline: " +
        "either the deposit for a PENDING booking (bookingId) or an issued contract instalment invoice (invoiceId). " +
        "The user must approve before it runs. Never call it for a venue that is only a search result: it needs an existing booking or invoice id.",
      // One object with either id: tool inputs must be a top-level object (Gemini rejects a union).
      inputSchema: z.object({
        bookingId: z.uuid().nullish().describe("A pending booking to take the deposit for."),
        invoiceId: z.uuid().nullish().describe("An issued instalment invoice to pay. Give this or bookingId, not both."),
      }),
      execute: (input) => createPayment(input, member, origin),
      // The model only needs the outcome; the checkout details are for the browser.
      toModelOutput: ({ output }) => ({
        type: "json" as const,
        value: output.ok
          ? { ok: true, kind: output.kind, amountInr: output.amountInr, invoiceTotalInr: output.invoiceTotalInr, provider: output.checkout.provider }
          : { ok: false, error: output.error, ...("needsApproval" in output && { needsApproval: true, bookingId: output.bookingId }) },
      }),
    }),
  };
}

export type ConciergeTools = ReturnType<typeof createConciergeTools>;
