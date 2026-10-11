/**
 * Guest list and RSVP rules for event workspaces (mirrors migration 0022).
 * Pure: tests/event-workspace.test.mjs imports it directly.
 */
import type { PartStat } from "./ics.ts";

export const RSVP_STATUSES = ["INVITED", "ACCEPTED", "TENTATIVE", "DECLINED"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export const isRsvpStatus = (v: unknown): v is RsvpStatus => typeof v === "string" && (RSVP_STATUSES as readonly string[]).includes(v);

/** What a guest can answer (INVITED is "not answered yet"). */
export type RsvpAnswer = Exclude<RsvpStatus, "INVITED">;

export const RSVP_LABEL: Record<RsvpStatus, string> = {
  INVITED: "Awaiting reply",
  ACCEPTED: "Going",
  TENTATIVE: "Maybe",
  DECLINED: "Not going",
};

export const partstatOf = (s: RsvpStatus): PartStat => (s === "INVITED" ? "NEEDS-ACTION" : s);

export const MAX_GUESTS = 500;
export const MAX_PLUS_ONES = 5;

// Same as the event_attendees.email check: no characters that would need
// escaping in an iCalendar mailto: or a header.
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();
export const isValidEmail = (email: string) => email.length <= 254 && EMAIL.test(email);

export interface AttendeeInput {
  name: string;
  email: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateAttendee(raw: { name?: unknown; email?: unknown }): Result<AttendeeInput> {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  const email = normalizeEmail(String(raw.email ?? ""));
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the guest's name (2–80 characters)." };
  if (!isValidEmail(email)) return { ok: false, error: `${email || "That"} isn't a valid email address.` };
  return { ok: true, value: { name, email } };
}

/** "asha.rao" → "Asha Rao", for guests pasted as a bare email. */
function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * A pasted guest list, one per line, in any of the shapes spreadsheets and mail
 * clients produce:
 *   Asha Rao <asha@nimbus.in>   ·   Asha Rao, asha@nimbus.in   ·   asha@nimbus.in   ·   "Rao, Asha" <asha@nimbus.in>
 * Duplicate emails (and ones in `existing`) are skipped, not errors.
 */
export function parseGuestList(text: string, existing: Iterable<string> = []): { guests: AttendeeInput[]; errors: { line: number; error: string }[]; duplicates: number } {
  const seen = new Set([...existing].map(normalizeEmail));
  const guests: AttendeeInput[] = [];
  const errors: { line: number; error: string }[] = [];
  let duplicates = 0;
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    let name = "";
    let email = "";
    const angle = /^(.*)<([^>]+)>\s*$/.exec(line);
    if (angle) {
      name = angle[1].replace(/^["'\s]+|["',\s]+$/g, "");
      email = angle[2];
    } else {
      const parts = line.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
      const at = parts.findIndex((p) => p.includes("@"));
      if (at === -1) {
        errors.push({ line: i + 1, error: `No email address in "${line.slice(0, 40)}".` });
        return;
      }
      email = parts[at];
      name = parts.filter((_, j) => j !== at).join(" ");
    }
    email = normalizeEmail(email);
    const r = validateAttendee({ name: name || nameFromEmail(email), email });
    if (!r.ok) {
      errors.push({ line: i + 1, error: r.error });
      return;
    }
    if (seen.has(r.value.email)) {
      duplicates++;
      return;
    }
    seen.add(r.value.email);
    guests.push(r.value);
  });
  return { guests, errors, duplicates };
}

export interface RsvpResponse {
  status: RsvpAnswer;
  plusOnes: number;
  dietary: string | null;
}

export function validateRsvpResponse(raw: { status?: unknown; plusOnes?: unknown; dietary?: unknown }): Result<RsvpResponse> {
  const status = raw.status;
  if (status !== "ACCEPTED" && status !== "TENTATIVE" && status !== "DECLINED") return { ok: false, error: "Choose going, maybe or not going." };
  const plusOnes = status === "DECLINED" ? 0 : Number(raw.plusOnes ?? 0);
  if (!Number.isInteger(plusOnes) || plusOnes < 0 || plusOnes > MAX_PLUS_ONES) return { ok: false, error: `You can bring up to ${MAX_PLUS_ONES} guests.` };
  const dietary = String(raw.dietary ?? "").replace(/\s+/g, " ").trim();
  if (dietary.length > 200) return { ok: false, error: "Keep dietary notes under 200 characters." };
  return { ok: true, value: { status, plusOnes, dietary: dietary || null } };
}

/** Booking statuses whose events still take RSVPs. */
const PLANNABLE = new Set(["PENDING_APPROVAL", "PENDING", "CONFIRMED"]);

/** Whether guests can still answer, and if not, why (shown on the RSVP page). */
export function rsvpWindow(input: { bookingStatus: string; eventDate: string; deadline: string | null; today: string }): { open: true } | { open: false; reason: string } {
  if (input.bookingStatus === "CANCELLED") return { open: false, reason: "This event has been cancelled." };
  if (!PLANNABLE.has(input.bookingStatus) || input.eventDate < input.today) return { open: false, reason: "This event has already taken place." };
  if (input.deadline && input.deadline < input.today) return { open: false, reason: "RSVPs for this event have closed." };
  return { open: true };
}

/** Whether the workspace (schedule and guest list) can still change. */
export const isPlannable = (bookingStatus: string) => PLANNABLE.has(bookingStatus);

export interface RsvpSummary {
  invited: number;
  going: number;
  maybe: number;
  declined: number;
  awaiting: number;
  /** Going guests plus the people they bring. */
  expected: number;
  /** Expected if every "maybe" (and their guests) comes too. */
  expectedHigh: number;
  /** The booked party size. */
  capacity: number;
  overCapacity: boolean;
  responseRate: number;
}

export function summarizeRsvps(attendees: { rsvp_status: string; plus_ones: number }[], capacity: number): RsvpSummary {
  const by = (s: RsvpStatus) => attendees.filter((a) => a.rsvp_status === s);
  const heads = (rows: { plus_ones: number }[]) => rows.reduce((n, a) => n + 1 + a.plus_ones, 0);
  const going = by("ACCEPTED");
  const maybe = by("TENTATIVE");
  const expected = heads(going);
  const awaiting = by("INVITED").length;
  return {
    invited: attendees.length,
    going: going.length,
    maybe: maybe.length,
    declined: by("DECLINED").length,
    awaiting,
    expected,
    expectedHigh: expected + heads(maybe),
    capacity,
    overCapacity: expected > capacity,
    responseRate: attendees.length ? (attendees.length - awaiting) / attendees.length : 0,
  };
}

export interface ScheduleInput {
  title: string | null;
  startsAt: string;
  endsAt: string;
  rsvpDeadline: string | null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateSchedule(raw: { title?: unknown; startsAt?: unknown; endsAt?: unknown; rsvpDeadline?: unknown }, eventDate: string): Result<ScheduleInput> {
  const title = String(raw.title ?? "").replace(/\s+/g, " ").trim();
  const startsAt = String(raw.startsAt ?? "").slice(0, 5);
  const endsAt = String(raw.endsAt ?? "").slice(0, 5);
  const rsvpDeadline = String(raw.rsvpDeadline ?? "").trim();
  if (title && (title.length < 2 || title.length > 120)) return { ok: false, error: "The event name must be 2–120 characters." };
  if (!TIME.test(startsAt) || !TIME.test(endsAt)) return { ok: false, error: "Enter start and end times as HH:MM." };
  if (startsAt === endsAt) return { ok: false, error: "The event must end after it starts." };
  if (rsvpDeadline && !DATE.test(rsvpDeadline)) return { ok: false, error: "Enter the RSVP deadline as a date." };
  if (rsvpDeadline && rsvpDeadline > eventDate) return { ok: false, error: "The RSVP deadline must be on or before the event date." };
  return { ok: true, value: { title: title || null, startsAt, endsAt, rsvpDeadline: rsvpDeadline || null } };
}

/**
 * Dietary needs across guests who are coming (Going or Maybe), for the
 * kitchen: free-text notes split on commas and semicolons, matched case-
 * insensitively, most common first.
 */
export function summarizeDietary(attendees: { rsvp_status: string; dietary: string | null }[]): { need: string; count: number }[] {
  const counts = new Map<string, { need: string; count: number }>();
  for (const a of attendees) {
    if ((a.rsvp_status !== "ACCEPTED" && a.rsvp_status !== "TENTATIVE") || !a.dietary) continue;
    for (const part of a.dietary.split(/[,;]+/)) {
      const need = part.trim().replace(/\s+/g, " ").replace(/\.$/, "");
      if (!need) continue;
      const key = need.toLowerCase();
      const entry = counts.get(key) ?? counts.set(key, { need: need[0].toUpperCase() + need.slice(1), count: 0 }).get(key)!;
      entry.count += 1;
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.need.localeCompare(b.need));
}
