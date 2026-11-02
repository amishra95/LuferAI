/**
 * iCalendar (RFC 5545) invites for event workspaces. Pure, so
 * tests/event-workspace.test.mjs can check the exact bytes.
 *
 * Times are IST wall clock (the platform is India-only). Asia/Kolkata has had a
 * fixed +05:30 offset with no DST since 1945, so events are written in UTC and
 * no VTIMEZONE is needed; every calendar shows them in the reader's own zone.
 *
 * Two kinds of file:
 * - the organiser's export (METHOD:REQUEST with every guest as an ATTENDEE, or
 *   METHOD:CANCEL once the booking is cancelled), for Outlook / Google to send;
 * - a guest's "add to calendar" file (METHOD:PUBLISH, no guest list: one guest
 *   never sees the others' emails).
 * Both share the workspace's UID, and its SEQUENCE goes up whenever the title or
 * times change, so re-importing replaces the entry instead of duplicating it.
 */

export type PartStat = "NEEDS-ACTION" | "ACCEPTED" | "TENTATIVE" | "DECLINED";

export interface IcsAttendee {
  name: string;
  email: string;
  partstat: PartStat;
}

export interface IcsEvent {
  /** Stable across exports: the booking id. */
  uid: string;
  /** event_workspaces.ics_sequence. */
  sequence: number;
  /** YYYY-MM-DD, IST. */
  date: string;
  /** HH:MM or HH:MM:SS, IST. An end at or before the start is the next day. */
  start: string;
  end: string;
  summary: string;
  location?: string;
  description?: string;
  url?: string;
  organizer?: { name: string; email: string };
  attendees?: IcsAttendee[];
  cancelled?: boolean;
  /** When the file was generated (DTSTAMP). */
  now: Date;
}

const IST_OFFSET_MIN = 330;
const PRODID = "-//Lufer//Event Workspace//EN";

/** IST date + time → UTC basic format, e.g. 20261120T133000Z. */
export function istToUtcStamp(date: string, time: string, addDays = 0): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!d || !t) throw new Error(`Invalid date/time: ${date} ${time}`);
  const ms = Date.UTC(+d[1], +d[2] - 1, +d[3] + addDays, +t[1], +t[2], +(t[3] ?? 0)) - IST_OFFSET_MIN * 60_000;
  return utcStamp(new Date(ms));
}

export const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/** TEXT value escaping (§3.3.11). */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Parameter values (§3.2): quoted when they contain : ; or , — and DQUOTE can't appear at all. */
export function paramValue(value: string): string {
  const v = value.replace(/["\r\n]/g, "").trim();
  return /[:;,]/.test(v) ? `"${v}"` : v;
}

/**
 * Folds a content line at 75 octets (§3.1): continuation lines start with a
 * space. Splits between UTF-8 characters, never inside one (₹, Devanagari…).
 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // The first line carries 75 octets; continuations 74 plus the leading space.
    const limit = out.length === 0 ? 75 : 74;
    if (octets + n > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** The .ics file for `event`. `withAttendees` makes it the organiser's invite. */
export function buildIcs(event: IcsEvent, { withAttendees }: { withAttendees: boolean }): string {
  // iTIP (RFC 5546) REQUEST and CANCEL need an ORGANIZER; without one it is a plain publish.
  const method = !withAttendees || !event.organizer ? "PUBLISH" : event.cancelled ? "CANCEL" : "REQUEST";
  const overnight = minutesOf(event.end) <= minutesOf(event.start) ? 1 : 0;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}@luferai`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${utcStamp(event.now)}`,
    `DTSTART:${istToUtcStamp(event.date, event.start)}`,
    `DTEND:${istToUtcStamp(event.date, event.end, overnight)}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(`STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`, "TRANSP:OPAQUE");
  if (withAttendees && event.organizer) {
    lines.push(`ORGANIZER;CN=${paramValue(event.organizer.name)}:mailto:${event.organizer.email}`);
  }
  if (withAttendees) {
    for (const a of event.attendees ?? []) {
      lines.push(`ATTENDEE;CN=${paramValue(a.name)};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=${a.partstat};RSVP=${a.partstat === "NEEDS-ACTION" ? "TRUE" : "FALSE"}:mailto:${a.email}`);
    }
  }
  if (!event.cancelled) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(event.summary)}`, "TRIGGER:-PT2H", "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A safe download name: "offsite-dinner-2026-11-20.ics". */
export function icsFilename(summary: string, date: string): string {
  const slug = summary
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `${slug || "event"}-${date}.ics`;
}
