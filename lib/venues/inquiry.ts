/**
 * A venue's inquiry conversations (migration 20261104000000): what a lead
 * needs before the venue can quote, reading those details out of messages,
 * suggesting other network venues when this one can't host, and the replies
 * used when no AI model is configured. Pure: tests/venue-inquiries.test.mjs
 * imports it directly; lib/venues/inquiry-agent.ts runs the conversation.
 */
import { parseReservationText } from "../channels/parse-reservation.ts";
import { normalizePhone } from "../phone.ts";
import { distanceKm } from "./discovery.ts";

export const INQUIRY_STATUSES = ["open", "qualified", "referred", "converted", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const isInquiryStatus = (v: unknown): v is InquiryStatus => typeof v === "string" && (INQUIRY_STATUSES as readonly string[]).includes(v);

export interface InquiryMessage {
  role: "visitor" | "agent";
  text: string;
  at: string;
}

/** Turns kept per conversation; the oldest go first. */
export const MAX_TURNS = 40;
export const MAX_MESSAGE_CHARS = 2000;

export interface LeadDetails {
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  company_name: string | null;
  party_size: number | null;
  /** YYYY-MM-DD */
  event_date: string | null;
  budget_per_head_inr: number | null;
  occasion: string | null;
}

export const EMPTY_DETAILS: LeadDetails = {
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  company_name: null,
  party_size: null,
  event_date: null,
  budget_per_head_inr: null,
  occasion: null,
};

/** What a venue needs to quote: who to reply to, how many and when. */
export type MissingDetail = "contact" | "name" | "party_size" | "event_date";

export function missingDetails(d: LeadDetails): MissingDetail[] {
  const out: MissingDetail[] = [];
  if (!d.party_size) out.push("party_size");
  if (!d.event_date) out.push("event_date");
  if (!d.contact_name) out.push("name");
  if (!d.contact_email && !d.contact_phone) out.push("contact");
  return out;
}

export const isQualified = (d: LeadDetails) => missingDetails(d).length === 0;

/** Later values win; nulls never erase what's known. Party size and budget are sanity-checked. */
export function mergeDetails(prev: LeadDetails, next: Partial<LeadDetails>): LeadDetails {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next) as [keyof LeadDetails, LeadDetails[keyof LeadDetails]][]) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "party_size" && !(typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5000)) continue;
    if (k === "budget_per_head_inr" && !(typeof v === "number" && v > 0 && v <= 100_000)) continue;
    if (k === "event_date" && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) continue;
    if (k === "contact_email" && !(typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) continue;
    (out as Record<string, unknown>)[k] = typeof v === "string" ? v.trim().slice(0, k === "occasion" ? 200 : 120) : v;
  }
  return out;
}

const EMAIL = /[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/;
// The lead-in in any case; the name itself capitalised, so "I am hosting…" isn't read as a name.
const NAME = /\b(?:[Ii] am|I'm|[Tt]his is|[Mm]y name is|[Nn]ame is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;
const COMPANY = /\b(?:from|at|with|for)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3}?)\s+([Cc]ompany|[Tt]eam|[Pp]vt|[Pp]rivate|[Ll]td|[Ll]imited|[Ii]nc|[Tt]echnologies|[Ll]abs)\b/;
/** Kept as part of the name ("Nimbus Technologies"); "company" and "team" aren't. */
const LEGAL_SUFFIX = /^(pvt|private|ltd|limited|inc|technologies|labs)$/i;

/**
 * The details a message states, read without a model: guests, date and budget
 * (the WhatsApp concierge's parser), an email, an Indian or international
 * mobile number, "I'm Asha Rao", "from Nimbus Technologies".
 */
export function extractDetails(text: string, today: string): Partial<LeadDetails> {
  const parsed = parseReservationText(text, { venueNames: [], areas: [] }, today);
  const email = EMAIL.exec(text)?.[0]?.toLowerCase() ?? null;
  const phoneRaw = PHONE.exec(text.replace(EMAIL, " "))?.[0] ?? null;
  const name = NAME.exec(text)?.[1] ?? null;
  const company = COMPANY.exec(text);
  const companyName = company ? (LEGAL_SUFFIX.test(company[2]) ? `${company[1]} ${company[2]}` : company[1]) : null;
  return {
    party_size: parsed.guests ?? null,
    event_date: parsed.date ?? null,
    budget_per_head_inr: parsed.budgetPerHead ?? null,
    contact_email: email,
    contact_phone: phoneRaw ? normalizePhone(phoneRaw) || null : null,
    contact_name: name,
    company_name: companyName,
  };
}

/** Appends turns, keeping the latest MAX_TURNS and clipping long messages. */
export function appendTurns(messages: readonly InquiryMessage[], ...turns: InquiryMessage[]): InquiryMessage[] {
  return [...messages, ...turns.map((t) => ({ ...t, text: t.text.slice(0, MAX_MESSAGE_CHARS) }))].slice(-MAX_TURNS);
}

/** Converted and closed are the venue's decisions: the agent never reopens them. */
export function nextStatus(prev: InquiryStatus, s: { qualified: boolean; referred: boolean }): InquiryStatus {
  if (prev === "converted" || prev === "closed") return prev;
  if (s.referred) return "referred";
  if (s.qualified) return "qualified";
  return prev === "referred" || prev === "qualified" ? prev : "open";
}

// ----------------------------------------------------------------------------
// Alternatives in the network
// ----------------------------------------------------------------------------

export interface NetworkVenue {
  id: string;
  name: string;
  neighborhood: string;
  city: string;
  capacity_max: number;
  latitude: number | null;
  longitude: number | null;
  /** The cheapest per head it advertises, if any. */
  from_per_head_inr: number | null;
}

export const MAX_ALTERNATIVES = 3;

/**
 * Other venues in the same city that can seat the party and are free that
 * day, nearest first (then the closest in size): where the lead goes when the
 * venue can't host, instead of being lost.
 */
export function rankAlternatives(origin: NetworkVenue, candidates: readonly NetworkVenue[], opts: { partySize: number | null; available: ReadonlySet<string> }, limit = MAX_ALTERNATIVES): NetworkVenue[] {
  const away = (v: NetworkVenue) =>
    origin.latitude != null && origin.longitude != null && v.latitude != null && v.longitude != null ? distanceKm({ latitude: origin.latitude, longitude: origin.longitude }, { latitude: v.latitude, longitude: v.longitude }) : Number.POSITIVE_INFINITY;
  return candidates
    .filter((v) => v.id !== origin.id && v.city === origin.city && opts.available.has(v.id) && (!opts.partySize || v.capacity_max >= opts.partySize))
    .sort((a, b) => away(a) - away(b) || Math.abs(a.capacity_max - (opts.partySize ?? 0)) - Math.abs(b.capacity_max - (opts.partySize ?? 0)))
    .slice(0, limit);
}

// ----------------------------------------------------------------------------
// Replies without a model
// ----------------------------------------------------------------------------

const DATE = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const formatEventDate = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

const ASK: Record<MissingDetail, string> = {
  party_size: "how many guests",
  event_date: "the date",
  name: "your name",
  contact: "an email or mobile number we can reply on",
};

/** A short, helpful reply from what's known: availability, alternatives, then the next thing to ask. */
export function fallbackReply(input: {
  venueName: string;
  details: LeadDetails;
  availability: "available" | "unavailable" | null;
  capacityMax: number;
  alternatives: readonly NetworkVenue[];
  altLink: (venueId: string) => string;
}): string {
  const { details: d } = input;
  const parts: string[] = [];
  if (d.party_size && d.party_size > input.capacityMax) {
    parts.push(`${input.venueName} seats up to ${input.capacityMax}, so ${d.party_size} guests won't fit.`);
  } else if (input.availability === "available" && d.event_date) {
    parts.push(`Good news: ${input.venueName} is free on ${formatEventDate(d.event_date)}${d.party_size ? ` for ${d.party_size} guests` : ""}.`);
  } else if (input.availability === "unavailable" && d.event_date) {
    parts.push(`${input.venueName} is already booked on ${formatEventDate(d.event_date)}.`);
  }
  if (input.alternatives.length) {
    parts.push(
      `These nearby venues are free and can seat your group: ${input.alternatives
        .map((v) => `${v.name}, ${v.neighborhood}${v.from_per_head_inr ? ` (from ${INR.format(v.from_per_head_inr)}/head)` : ""}: ${input.altLink(v.id)}`)
        .join("; ")}.`
    );
  }
  const missing = missingDetails(d);
  if (missing.length) {
    const asks = missing.map((m) => ASK[m]);
    parts.push(`To get you a quote, could you share ${asks.length > 1 ? `${asks.slice(0, -1).join(", ")} and ${asks.at(-1)}` : asks[0]}?`);
  } else if (!input.alternatives.length) {
    parts.push(`Thanks, ${d.contact_name?.split(" ")[0] ?? "that's everything"}. ${input.venueName}'s team will get back to you with a quote shortly.`);
  }
  return parts.join(" ") || `Hi! Tell me about your event at ${input.venueName}: the date, how many guests, and your budget per head.`;
}
