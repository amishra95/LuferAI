import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, escapeText, foldLine, icsFilename, istToUtcStamp, paramValue } from "../lib/events/ics.ts";
import { eventTitle, inviteEvent } from "../lib/events/invite.ts";
import { colorFor, displayName, liveCursors, normalizeCursor, parseCursor, roster } from "../lib/events/presence.ts";
import { isPlannable, parseGuestList, rsvpWindow, summarizeRsvps, validateAttendee, validateRsvpResponse, validateSchedule } from "../lib/events/rsvp.ts";

const NOW = new Date("2026-10-11T06:30:00Z");
const ROOM = {
  booking: {
    id: "b0000000-0000-4000-8000-000000000001",
    event_date: "2026-11-20",
    status: "CONFIRMED",
    party_size: 30,
    company: { legal_name: "Nimbus Analytics Pvt Ltd" },
    venue: { name: "The Copper Courtyard", neighborhood: "Indiranagar", city: "Bengaluru" },
  },
  workspace: { title: "Q3 offsite dinner", starts_at: "19:30:00", ends_at: "23:00:00", ics_sequence: 2 },
  attendees: [
    { name: "Asha Rao", email: "asha@nimbus.in", rsvp_status: "ACCEPTED" },
    { name: "Rao, Dev", email: "dev@nimbus.in", rsvp_status: "INVITED" },
  ],
};
const lines = (ics) => ics.split("\r\n");
const unfold = (ics) => ics.replace(/\r\n /g, "");

// ----------------------------------------------------------------------------
// iCalendar
// ----------------------------------------------------------------------------

test("ics: IST wall clock → UTC, overnight ends roll to the next day", () => {
  assert.equal(istToUtcStamp("2026-11-20", "19:30"), "20261120T140000Z");
  assert.equal(istToUtcStamp("2026-11-20", "03:00"), "20261119T213000Z");
  assert.equal(istToUtcStamp("2026-12-31", "01:00", 1), "20261231T193000Z");
  const ics = buildIcs({ ...inviteEvent(ROOM, { now: NOW }), start: "21:00", end: "01:00" }, { withAttendees: false });
  assert.ok(ics.includes("DTSTART:20261120T153000Z\r\n"));
  assert.ok(ics.includes("DTEND:20261120T193000Z\r\n"));
});

test("ics: text and parameter escaping", () => {
  assert.equal(escapeText("Dinner; drinks, then\\karaoke\nTill late"), "Dinner\\; drinks\\, then\\\\karaoke\\nTill late");
  assert.equal(paramValue("Rao, Dev"), '"Rao, Dev"');
  assert.equal(paramValue('Asha "AR" Rao'), "Asha AR Rao");
  assert.equal(paramValue("Asha Rao"), "Asha Rao");
});

test("ics: lines fold at 75 octets without splitting UTF-8 characters", () => {
  const long = `SUMMARY:${"₹".repeat(40)}`; // 8 + 120 octets
  const folded = foldLine(long);
  for (const l of folded.split("\r\n")) assert.ok(new TextEncoder().encode(l).length <= 75, l);
  assert.equal(folded.replace(/\r\n /g, ""), long);
  assert.equal(foldLine("SHORT:x"), "SHORT:x");
});

test("ics: organiser invite is a REQUEST with every guest's reply; CRLF throughout", () => {
  const ics = buildIcs(inviteEvent(ROOM, { now: NOW, organizer: { name: "Asha (Nimbus)", email: "asha@nimbus.in" } }), { withAttendees: true });
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "bare LF");
  const flat = lines(unfold(ics));
  assert.ok(flat.includes("METHOD:REQUEST"));
  assert.ok(flat.includes(`UID:${ROOM.booking.id}@luferai`));
  assert.ok(flat.includes("SEQUENCE:2"));
  assert.ok(flat.includes("DTSTAMP:20261011T063000Z"));
  assert.ok(flat.includes("DTSTART:20261120T140000Z"));
  assert.ok(flat.includes("DTEND:20261120T173000Z"));
  assert.ok(flat.includes("SUMMARY:Q3 offsite dinner"));
  assert.ok(flat.includes("LOCATION:The Copper Courtyard\\, Indiranagar\\, Bengaluru"));
  assert.ok(flat.includes("ORGANIZER;CN=Asha (Nimbus):mailto:asha@nimbus.in"));
  assert.ok(flat.includes("ATTENDEE;CN=Asha Rao;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:asha@nimbus.in"));
  assert.ok(flat.includes('ATTENDEE;CN="Rao, Dev";CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:dev@nimbus.in'));
  assert.ok(flat.includes("TRIGGER:-PT2H"));
});

test("ics: guest file is a PUBLISH with no guest list; cancelled bookings cancel", () => {
  const guest = unfold(buildIcs(inviteEvent(ROOM, { now: NOW, url: "https://app.test/rsvp/abc" }), { withAttendees: false }));
  assert.ok(guest.includes("METHOD:PUBLISH"));
  assert.ok(!guest.includes("ATTENDEE"));
  assert.ok(!guest.includes("ORGANIZER"));
  assert.ok(guest.includes("URL:https://app.test/rsvp/abc"));
  assert.ok(guest.includes("DESCRIPTION:Hosted by Nimbus Analytics Pvt Ltd.\\nRSVP or update your reply: https://app.test/rsvp/abc"));

  const cancelled = { ...ROOM, booking: { ...ROOM.booking, status: "CANCELLED" } };
  const org = unfold(buildIcs(inviteEvent(cancelled, { now: NOW, organizer: { name: "A", email: "a@nimbus.in" } }), { withAttendees: true }));
  assert.ok(org.includes("METHOD:CANCEL"));
  assert.ok(org.includes("STATUS:CANCELLED"));
  assert.ok(!org.includes("VALARM"));
  // No organiser: iTIP needs one, so it falls back to a plain publish.
  assert.ok(unfold(buildIcs(inviteEvent(ROOM, { now: NOW }), { withAttendees: true })).includes("METHOD:PUBLISH"));
});

test("ics: titles default to company at venue; filenames are safe", () => {
  assert.equal(eventTitle({ ...ROOM, workspace: { ...ROOM.workspace, title: null } }), "Nimbus Analytics Pvt Ltd at The Copper Courtyard");
  assert.equal(icsFilename("Q3 Offsite: Dinner & Drinks!", "2026-11-20"), "q3-offsite-dinner-drinks-2026-11-20.ics");
  assert.equal(icsFilename("“…”", "2026-11-20"), "event-2026-11-20.ics");
});

// ----------------------------------------------------------------------------
// Guest list and RSVPs
// ----------------------------------------------------------------------------

test("guests: pasted lists in every common shape; duplicates skipped", () => {
  const r = parseGuestList(
    ['Asha Rao <Asha@Nimbus.in>', '"Rao, Dev" <dev@nimbus.in>', "Meera Shah, meera@nimbus.in", "kiran.kumar@nimbus.in", "", "asha@nimbus.in", "Nobody here", "Bad <not-an-email>", "old@nimbus.in"].join("\n"),
    ["OLD@nimbus.in"]
  );
  assert.deepEqual(r.guests, [
    { name: "Asha Rao", email: "asha@nimbus.in" },
    { name: "Rao, Dev", email: "dev@nimbus.in" },
    { name: "Meera Shah", email: "meera@nimbus.in" },
    { name: "Kiran Kumar", email: "kiran.kumar@nimbus.in" },
  ]);
  assert.equal(r.duplicates, 2);
  assert.deepEqual(r.errors.map((e) => e.line), [7, 8]);
  assert.match(r.errors[0].error, /No email address/);
});

test("guests: emails that would break a calendar invite are rejected", () => {
  assert.equal(validateAttendee({ name: "A B", email: "a;b@x.in" }).ok, false);
  assert.equal(validateAttendee({ name: "A B", email: "a@x" }).ok, false);
  assert.equal(validateAttendee({ name: "A", email: "a@x.in" }).ok, false);
  assert.deepEqual(validateAttendee({ name: "  Asha   Rao ", email: " ASHA@X.IN " }), { ok: true, value: { name: "Asha Rao", email: "asha@x.in" } });
});

test("rsvp: replies validated; declining drops plus-ones", () => {
  assert.deepEqual(validateRsvpResponse({ status: "DECLINED", plusOnes: 3, dietary: "" }), { ok: true, value: { status: "DECLINED", plusOnes: 0, dietary: null } });
  assert.deepEqual(validateRsvpResponse({ status: "ACCEPTED", plusOnes: "2", dietary: " Jain  " }), { ok: true, value: { status: "ACCEPTED", plusOnes: 2, dietary: "Jain" } });
  assert.equal(validateRsvpResponse({ status: "INVITED" }).ok, false);
  assert.match(validateRsvpResponse({ status: "ACCEPTED", plusOnes: 6 }).error, /up to 5/);
  assert.match(validateRsvpResponse({ status: "TENTATIVE", plusOnes: 1.5 }).error, /up to 5/);
});

test("rsvp: the window closes on cancellation, after the event, and after the deadline", () => {
  const base = { bookingStatus: "CONFIRMED", eventDate: "2026-11-20", deadline: "2026-11-10", today: "2026-10-11" };
  assert.deepEqual(rsvpWindow(base), { open: true });
  assert.deepEqual(rsvpWindow({ ...base, today: "2026-11-10" }), { open: true });
  assert.match(rsvpWindow({ ...base, today: "2026-11-11" }).reason, /closed/);
  assert.match(rsvpWindow({ ...base, bookingStatus: "CANCELLED" }).reason, /cancelled/);
  assert.match(rsvpWindow({ ...base, bookingStatus: "COMPLETED" }).reason, /taken place/);
  assert.match(rsvpWindow({ ...base, deadline: null, today: "2026-11-21" }).reason, /taken place/);
  assert.equal(isPlannable("PENDING_APPROVAL"), true);
  assert.equal(isPlannable("SETTLED"), false);
});

test("rsvp: summary counts heads, not rows, and flags going over the booking", () => {
  const s = summarizeRsvps(
    [
      { rsvp_status: "ACCEPTED", plus_ones: 2 },
      { rsvp_status: "ACCEPTED", plus_ones: 0 },
      { rsvp_status: "TENTATIVE", plus_ones: 1 },
      { rsvp_status: "DECLINED", plus_ones: 0 },
      { rsvp_status: "INVITED", plus_ones: 0 },
    ],
    3
  );
  assert.deepEqual(s, { invited: 5, going: 2, maybe: 1, declined: 1, awaiting: 1, expected: 4, expectedHigh: 6, capacity: 3, overCapacity: true, responseRate: 0.8 });
  assert.equal(summarizeRsvps([], 10).responseRate, 0);
});

test("schedule: times, names and a deadline on or before the event", () => {
  assert.deepEqual(validateSchedule({ title: " ", startsAt: "19:00", endsAt: "01:00", rsvpDeadline: "" }, "2026-11-20"), {
    ok: true,
    value: { title: null, startsAt: "19:00", endsAt: "01:00", rsvpDeadline: null },
  });
  assert.equal(validateSchedule({ startsAt: "19:00:00", endsAt: "22:00:00" }, "2026-11-20").ok, true);
  assert.match(validateSchedule({ startsAt: "19:00", endsAt: "19:00" }, "2026-11-20").error, /end after/);
  assert.match(validateSchedule({ startsAt: "25:00", endsAt: "19:00" }, "2026-11-20").error, /HH:MM/);
  assert.match(validateSchedule({ startsAt: "19:00", endsAt: "22:00", rsvpDeadline: "2026-11-21" }, "2026-11-20").error, /on or before/);
});

// ----------------------------------------------------------------------------
// Presence and cursors
// ----------------------------------------------------------------------------

test("presence: one entry per person (tabs merged), you first, then by arrival", () => {
  const state = {
    u2: [{ userId: "u2", name: "Dev Iyer", joinedAt: "2026-10-11T10:00:00Z", section: "guests" }],
    u1: [
      { userId: "u1", name: "Asha Rao", joinedAt: "2026-10-11T10:05:00Z", section: "schedule" },
      { userId: "u1", name: "Asha Rao", joinedAt: "2026-10-11T10:09:00Z", section: "invite" },
    ],
    u3: [{ userId: "u3", name: "Meera Shah", joinedAt: "2026-10-11T09:00:00Z", section: null }],
    junk: [{ presence_ref: "x" }],
  };
  const people = roster(state, "u1");
  assert.deepEqual(people.map((p) => [p.userId, p.self, p.tabs, p.section, p.initials]), [
    ["u1", true, 2, "invite", "AR"],
    ["u3", false, 1, null, "MS"],
    ["u2", false, 1, "guests", "DI"],
  ]);
  assert.equal(colorFor("u1"), colorFor("u1"));
  assert.match(colorFor("anything"), /^#[0-9a-f]{6}$/);
  assert.equal(displayName("asha.rao@nimbus.in"), "Asha Rao");
  assert.equal(displayName(null), "Teammate");
});

test("cursors: normalised to the canvas, validated on receipt, expire", () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };
  assert.deepEqual(normalizeCursor(500, 250, rect), { x: 0.5, y: 0.5 });
  assert.equal(normalizeCursor(99, 250, rect), null);
  assert.equal(normalizeCursor(1, 1, { ...rect, width: 0 }), null);
  assert.deepEqual(parseCursor({ userId: "u2", x: 0.25, y: 1 }, "u1"), { userId: "u2", x: 0.25, y: 1 });
  assert.equal(parseCursor({ userId: "u1", x: 0.1, y: 0.1 }, "u1"), null);
  assert.equal(parseCursor({ userId: "u2", x: 2, y: 0.1 }, "u1"), null);
  assert.equal(parseCursor({ userId: "u2", x: "0.1", y: 0.1 }, "u1"), null);
  assert.equal(parseCursor(null, "u1"), null);
  const map = new Map([
    ["u2", { userId: "u2", x: 0.1, y: 0.1, seenAt: 1_000 }],
    ["u3", { userId: "u3", x: 0.2, y: 0.2, seenAt: 20_000 }],
    ["u4", { userId: "u4", x: 0.3, y: 0.3, seenAt: 20_000 }],
  ]);
  assert.deepEqual(liveCursors(map, new Set(["u2", "u3"]), 21_000).map((c) => c.userId), ["u3"]);
});

// ----------------------------------------------------------------------------
// Activity ticker
// ----------------------------------------------------------------------------

test("activity: seeded from replies, batched guest adds and the last schedule change", async () => {
  const { seedActivity } = await import("../lib/events/activity.ts");
  const guest = (id, name, created_at, extra = {}) => ({ id, name, rsvp_status: "INVITED", responded_at: null, created_at, invited_by: "u1", ...extra });
  const items = seedActivity({
    attendees: [
      guest("g1", "Asha Rao", "2026-10-11T10:00:00Z", { rsvp_status: "ACCEPTED", responded_at: "2026-10-11T12:00:00Z" }),
      guest("g2", "Dev Iyer", "2026-10-11T10:00:40Z"),
      guest("g3", "Meera Shah", "2026-10-11T10:01:30Z", { rsvp_status: "DECLINED", responded_at: "2026-10-11T11:00:00Z" }),
      guest("g4", "Kiran Kumar", "2026-10-11T10:30:00Z", { invited_by: "u2" }),
    ],
    workspace: { id: "w1", updated_at: "2026-10-11T11:30:00Z", ics_sequence: 2, updated_by: "u2" },
    people: { u1: "Asha Organiser", u2: "Ravi Approver" },
  });
  assert.deepEqual(
    items.map((i) => `${i.actor} ${i.text}`),
    ["Asha Rao replied going", "Ravi Approver updated the schedule", "Meera Shah replied not going", "Ravi Approver added Kiran Kumar", "Asha Organiser added 3 guests"]
  );
  const empty = seedActivity({ attendees: [], workspace: { id: "", updated_at: "1970-01-01T00:00:00Z", ics_sequence: 0, updated_by: null } });
  assert.deepEqual(empty, []);
});

test("activity: live items merge without duplicates; payloads from other browsers are validated", async () => {
  const { activityFromAttendeeChange, mergeActivity, parseActivity, relativeTime } = await import("../lib/events/activity.ts");
  const seeded = [{ id: "guests:g1", at: "2026-10-11T10:00:30Z", actor: "Asha", kind: "guests", text: "added 3 guests" }];
  const live = { id: "x1", at: "2026-10-11T10:00:00Z", actor: "Asha", kind: "guests", text: "added 3 guests" };
  assert.equal(mergeActivity(seeded, [live]).length, 1, "the broadcast and the re-seeded row are one event");
  assert.equal(mergeActivity(seeded, [{ ...live, at: "2026-10-11T10:05:00Z" }]).length, 2, "a later identical action is its own entry");
  assert.equal(mergeActivity([], Array.from({ length: 40 }, (_, i) => ({ ...live, id: `i${i}`, text: `t${i}` }))).length, 30);

  assert.deepEqual(parseActivity(live), live);
  assert.equal(parseActivity({ ...live, kind: "hack" }), null);
  assert.equal(parseActivity({ ...live, text: "x".repeat(141) }), null);
  assert.equal(parseActivity({ ...live, at: "yesterday" }), null);

  const row = { id: "g1", name: "Asha Rao", rsvp_status: "TENTATIVE", responded_at: "2026-10-11T12:00:00Z" };
  assert.deepEqual(activityFromAttendeeChange({ eventType: "UPDATE", new: row, old: { id: "g1" } }), { id: "rsvp:g1:2026-10-11T12:00:00Z", at: row.responded_at, actor: "Asha Rao", kind: "rsvp", text: "replied maybe" });
  assert.equal(activityFromAttendeeChange({ eventType: "INSERT", new: row }), null);
  assert.equal(activityFromAttendeeChange({ eventType: "UPDATE", new: { ...row, rsvp_status: "INVITED" } }), null);
  assert.equal(activityFromAttendeeChange({ eventType: "UPDATE", new: row, old: { rsvp_status: "TENTATIVE" } }), null);

  const now = Date.parse("2026-10-11T12:00:00Z");
  assert.equal(relativeTime("2026-10-11T11:59:30Z", now), "just now");
  assert.equal(relativeTime("2026-10-11T11:56:00Z", now), "4m ago");
  assert.equal(relativeTime("2026-10-11T09:00:00Z", now), "3h ago");
  assert.equal(relativeTime("2026-10-09T09:00:00Z", now), "9 Oct");
});
