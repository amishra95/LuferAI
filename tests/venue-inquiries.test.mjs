// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// The venue's AI inquiry agent:
//   1. the rules (lib/venues/inquiry.ts): reading details, qualifying, alternatives, replies
//   2. POST /api/inquiries on the in-memory store without a model: a conversation
//      that qualifies, a booked-out date referred to nearby venues, token scoping
//   3. the same with a model: Gemini's API stubbed, calling the agent's tools
//   4. the venue's status action, and migration 20261104000000's RLS (PGlite)
import { signIn } from "./support/server-actions.mjs";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { appendTurns, EMPTY_DETAILS, extractDetails, fallbackReply, isQualified, MAX_TURNS, mergeDetails, missingDetails, nextStatus, rankAlternatives } from "../lib/venues/inquiry.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const { POST } = await import("../app/api/inquiries/route.ts");
const { setInquiryStatusAction } = await import("../app/(dashboard)/property/actions.ts");
const { listInquiries } = await import("../lib/venues/inquiry-store.ts");
const { mutateDb, readDb } = await import("../lib/data/local-store.ts");

const TODAY = "2026-10-23";
// Seeded venues (lib/data/mock-store.ts), all in Bengaluru.
const COPPER = "aaaaaaaa-0001-4000-8000-000000000001"; // Indiranagar, 80
const SAFFRON = "aaaaaaaa-0002-4000-8000-000000000002"; // Indiranagar, 120
const MOSAIC = "aaaaaaaa-0003-4000-8000-000000000003"; // Koramangala, 150
const INDIGO = "aaaaaaaa-0004-4000-8000-000000000004"; // Koramangala, 60
const VAULT = "aaaaaaaa-0005-4000-8000-000000000005"; // UB City, 200

// ---------------------------------------------------------------------------
// 1. Rules
// ---------------------------------------------------------------------------

describe("inquiry rules", () => {
  test("a full first message yields every detail", () => {
    assert.deepEqual(extractDetails("Hi, I'm Asha Rao from Nimbus Technologies team: dinner for 40 on 20 Nov, ₹2,500 a head. asha@nimbus.in or +91 98450 12345", TODAY), {
      party_size: 40,
      event_date: "2026-11-20",
      budget_per_head_inr: 2500,
      contact_email: "asha@nimbus.in",
      contact_phone: "+919845012345",
      contact_name: "Asha Rao",
      company_name: "Nimbus Technologies",
    });
  });

  test("words that only look like names or companies aren't taken as them", () => {
    const d = extractDetails("I am hosting a dinner for the sales team", TODAY);
    assert.equal(d.contact_name, null);
    assert.equal(d.company_name, null);
  });

  test("merging keeps what's known and refuses implausible values", () => {
    const d = mergeDetails({ ...EMPTY_DETAILS, party_size: 40, contact_email: "a@b.in" }, { party_size: null, contact_email: "not-an-email", budget_per_head_inr: 0, event_date: "20 Nov", contact_name: "  Asha  " });
    assert.deepEqual([d.party_size, d.contact_email, d.budget_per_head_inr, d.event_date, d.contact_name], [40, "a@b.in", null, null, "Asha"]);
    assert.equal(mergeDetails(EMPTY_DETAILS, { party_size: 9000 }).party_size, null);
  });

  test("qualified once there's a count, a date, a name and a way to reply", () => {
    const full = { ...EMPTY_DETAILS, party_size: 40, event_date: "2026-11-20", contact_name: "Asha", contact_phone: "+919845012345" };
    assert.equal(isQualified(full), true);
    assert.deepEqual(missingDetails({ ...full, contact_phone: null }), ["contact"]);
    assert.deepEqual(missingDetails(EMPTY_DETAILS), ["party_size", "event_date", "name", "contact"]);
  });

  test("the transcript keeps the latest turns and clips long messages", () => {
    const turns = Array.from({ length: MAX_TURNS + 5 }, (_, i) => ({ role: "visitor", text: `m${i}`, at: TODAY }));
    const kept = appendTurns([], ...turns);
    assert.equal(kept.length, MAX_TURNS);
    assert.equal(kept[0].text, "m5");
    assert.equal(appendTurns([], { role: "visitor", text: "x".repeat(5000), at: TODAY })[0].text.length, 2000);
  });

  test("status: the agent moves open → qualified / referred, never reopens the venue's decisions", () => {
    assert.equal(nextStatus("open", { qualified: true, referred: false }), "qualified");
    assert.equal(nextStatus("open", { qualified: false, referred: true }), "referred");
    assert.equal(nextStatus("qualified", { qualified: false, referred: false }), "qualified");
    assert.equal(nextStatus("converted", { qualified: true, referred: true }), "converted");
    assert.equal(nextStatus("closed", { qualified: true, referred: false }), "closed");
  });

  test("alternatives: same city, big enough, free that day, nearest first", () => {
    const v = (id, city, cap, lat, lng) => ({ id, name: id, neighborhood: "x", city, capacity_max: cap, latitude: lat, longitude: lng, from_per_head_inr: null });
    const origin = v("origin", "Bengaluru", 80, 12.97, 77.64);
    const candidates = [origin, v("near", "Bengaluru", 100, 12.975, 77.64), v("far", "Bengaluru", 100, 12.93, 77.6), v("small", "Bengaluru", 30, 12.971, 77.64), v("busy", "Bengaluru", 100, 12.9705, 77.64), v("mumbai", "Mumbai", 300, 19, 72.8)];
    const ranked = rankAlternatives(origin, candidates, { partySize: 60, available: new Set(["near", "far", "small", "mumbai", "origin"]) });
    assert.deepEqual(ranked.map((x) => x.id), ["near", "far"]);
  });

  test("template replies: availability, referrals, and the next thing to ask", () => {
    const base = { venueName: "The Copper Courtyard", capacityMax: 80, alternatives: [], altLink: (id) => `/inquire/${id}` };
    assert.match(fallbackReply({ ...base, details: { ...EMPTY_DETAILS, party_size: 40, event_date: "2026-11-20" }, availability: "available" }), /^Good news: The Copper Courtyard is free on Fri, 20 Nov for 40 guests\. To get you a quote, could you share your name and an email or mobile number we can reply on\?$/);
    const referred = fallbackReply({ ...base, details: { ...EMPTY_DETAILS, party_size: 40, event_date: "2026-11-20" }, availability: "unavailable", alternatives: [{ id: "s", name: "Saffron Terrace", neighborhood: "Indiranagar", from_per_head_inr: 1800 }] });
    assert.match(referred, /already booked on Fri, 20 Nov\. These nearby venues are free and can seat your group: Saffron Terrace, Indiranagar \(from ₹1,800\/head\): \/inquire\/s\./);
    assert.match(fallbackReply({ ...base, details: { ...EMPTY_DETAILS, party_size: 200 }, availability: null }), /seats up to 80, so 200 guests won't fit/);
    assert.match(fallbackReply({ ...base, details: EMPTY_DETAILS, availability: null }), /could you share how many guests, the date, your name and an email/);
  });
});

// ---------------------------------------------------------------------------
// 2. The route, without a model
// ---------------------------------------------------------------------------

const send = (body) => POST(new Request("https://lufer.test/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const AI_KEYS = ["GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"];
// Far enough ahead to stay in the future; a Friday.
const DATE = "2027-11-19";

async function reset() {
  for (const k of AI_KEYS) delete process.env[k];
  await mutateDb((db) => {
    db.venueInquiries = [];
    db.blockedDates = db.blockedDates.filter((b) => !b.id.startsWith("b10cced0"));
  });
}
const block = (venue, n) =>
  mutateDb((db) => {
    db.blockedDates.push({ id: `b10cced0-0000-4000-8000-00000000000${n}`, venue_id: venue, blocked_date: DATE, reason: "Private event", created_by: null, created_at: new Date().toISOString() });
  });

describe("inquiry route (no model)", () => {
  beforeEach(reset);

  test("a first message starts a conversation, answers, and asks for what's missing", async () => {
    const res = await send({ venueId: COPPER, message: "Hi, team dinner for 40 on 19 Nov 2027?" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.status, "open");
    assert.equal(body.availability, "available");
    assert.match(body.reply, /^Good news: The Copper Courtyard is free on Fri, 19 Nov for 40 guests\./);
    assert.match(body.reply, /your name and an email or mobile/);
    const [row] = await listInquiries(COPPER);
    assert.equal(row.party_size, 40);
    assert.equal(row.event_date, DATE);
    assert.equal(row.date_available, true);
    assert.equal(row.messages.length, 2);
    // Only the token's hash is stored.
    assert.notEqual(row.token_sha256, body.token);
    assert.match(row.token_sha256, /^[0-9a-f]{64}$/);
  });

  test("continuing with the token builds up the lead until it's qualified", async () => {
    const { token } = await (await send({ venueId: COPPER, message: "Dinner for 40 on 19 Nov 2027" })).json();
    const second = await (await send({ venueId: COPPER, token, message: "I'm Asha Rao from Nimbus Technologies team, asha@nimbus.in" })).json();
    assert.equal(second.token, token, "same conversation");
    assert.equal(second.status, "qualified");
    assert.equal(second.reply, "Good news: The Copper Courtyard is free on Fri, 19 Nov for 40 guests. Thanks, Asha. The Copper Courtyard's team will get back to you with a quote shortly.");
    const rows = await listInquiries(COPPER);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].contact_name, rows[0].company_name, rows[0].contact_email, rows[0].status], ["Asha Rao", "Nimbus Technologies", "asha@nimbus.in", "qualified"]);
    assert.ok(rows[0].qualified_at);
    assert.equal(rows[0].messages.length, 4);
  });

  test("a booked-out date is referred to free venues nearby, and the lead is marked referred", async () => {
    await block(COPPER, 1);
    await block(SAFFRON, 2); // the nearest alternative is booked too
    const body = await (await send({ venueId: COPPER, message: "40 people on 19 Nov 2027" })).json();
    assert.equal(body.availability, "unavailable");
    assert.equal(body.status, "referred");
    const ids = body.alternatives.map((a) => a.id);
    assert.ok(!ids.includes(COPPER) && !ids.includes(SAFFRON), JSON.stringify(ids));
    assert.ok(ids.length > 0 && ids.length <= 3);
    // Indigo (60) and Mosaic (150) can seat 40; the nearest come first.
    assert.ok(ids.every((id) => [MOSAIC, INDIGO, VAULT].includes(id)));
    assert.match(body.alternatives[0].link, /\/inquire\/aaaaaaaa-/);
    assert.match(body.reply, /already booked on Fri, 19 Nov\. These nearby venues are free/);
    const [row] = await listInquiries(COPPER);
    assert.deepEqual(row.referred_venue_ids.sort(), ids.sort());
    assert.equal(row.date_available, false);
  });

  test("a party too big for the venue is pointed at venues that can seat it", async () => {
    const body = await (await send({ venueId: INDIGO, message: "We need space for 180 guests on 19 Nov 2027" })).json();
    assert.match(body.reply, /seats up to 60, so 180 guests won't fit/);
    assert.deepEqual(body.alternatives.map((a) => a.id), [VAULT], "only the Vault seats 180");
  });

  test("a token only reaches its own venue's conversation", async () => {
    const { token } = await (await send({ venueId: COPPER, message: "Dinner for 40, I'm Asha Rao" })).json();
    const elsewhere = await (await send({ venueId: SAFFRON, token, message: "Hello" })).json();
    assert.notEqual(elsewhere.token, token, "a new conversation at the other venue");
    assert.equal(elsewhere.details.contact_name, null, "nothing carried over");
    assert.equal((await listInquiries(COPPER)).length, 1);
    assert.equal((await listInquiries(SAFFRON)).length, 1);
    // A made-up token just starts afresh.
    assert.notEqual((await (await send({ venueId: COPPER, token: "x".repeat(43), message: "Hi" })).json()).token, "x".repeat(43));
  });

  test("bad requests and unknown venues", async () => {
    assert.equal((await send({ venueId: COPPER, message: "   " })).status, 400);
    assert.equal((await send({ venueId: "nope", message: "Hi" })).status, 400);
    assert.equal((await send({ venueId: COPPER, message: "x".repeat(2001) })).status, 400);
    assert.equal((await send({ venueId: "aaaaaaaa-9999-4000-8000-000000000009", message: "Hi" })).status, 404);
  });
});

// ---------------------------------------------------------------------------
// 3. With a model (Gemini's API stubbed)
// ---------------------------------------------------------------------------

describe("inquiry route (with a model)", () => {
  let calls = [];
  const realFetch = globalThis.fetch;
  before(() => {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://generativelanguage.googleapis.com/")) return realFetch(input, init);
      const body = JSON.parse(init.body);
      calls.push(body);
      const answered = body.contents.some((c) => c.parts?.some((p) => p.functionResponse));
      const parts = answered
        ? [{ text: "The Copper Courtyard is booked that Friday, but Mosaic Kitchen & Bar nearby is free. Shall I pass your details on?" }]
        : [
            { functionCall: { name: "recordLeadDetails", args: { contact_name: "Ravi Iyer", company_name: "Zenith", contact_email: "ravi@zenith.in", party_size: 40 } } },
            { functionCall: { name: "checkDate", args: { date: DATE, partySize: 40 } } },
          ];
      return Response.json({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
    };
  });
  after(() => {
    globalThis.fetch = realFetch;
    for (const k of AI_KEYS) delete process.env[k];
  });
  beforeEach(async () => {
    await reset();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    calls = [];
  });

  test("the model records details and checks the date through its tools; the venue's facts are in its instructions", async () => {
    await block(COPPER, 3);
    const body = await (await send({ venueId: COPPER, message: "Ravi from Zenith here, 40 of us next Friday the 19th. ravi@zenith.in" })).json();
    assert.equal(body.reply, "The Copper Courtyard is booked that Friday, but Mosaic Kitchen & Bar nearby is free. Shall I pass your details on?");
    assert.equal(body.availability, "unavailable");
    assert.equal(body.status, "referred");
    assert.ok(body.alternatives.length > 0);
    const [row] = await listInquiries(COPPER);
    assert.deepEqual([row.contact_name, row.company_name, row.contact_email, row.party_size, row.event_date], ["Ravi Iyer", "Zenith", "ravi@zenith.in", 40, DATE]);

    const system = calls[0].systemInstruction.parts.map((p) => p.text).join("");
    assert.match(system, /You are the events assistant for The Copper Courtyard/);
    assert.match(system, /Seats up to 80\./);
    assert.match(system, /Never invent prices/);
    assert.deepEqual(calls[0].tools[0].functionDeclarations.map((f) => f.name).sort(), ["checkDate", "recordLeadDetails"]);
  });

  test("if the model fails, the visitor still gets the template answer", async () => {
    globalThis.fetch = async (input, init) => (String(input).startsWith("https://generativelanguage.googleapis.com/") ? Response.json({ error: { message: "bad request" } }, { status: 400 }) : realFetch(input, init));
    const body = await (await send({ venueId: COPPER, message: "Dinner for 40 on 19 Nov 2027" })).json();
    assert.match(body.reply, /^Good news: The Copper Courtyard is free/);
  });
});

// ---------------------------------------------------------------------------
// 4. The venue's decisions, and RLS
// ---------------------------------------------------------------------------

describe("venue's status action", () => {
  beforeEach(reset);
  afterEach(() => signIn(null));

  const form = (fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  test("a venue's manager marks their lead won; another venue's manager can't touch it", async () => {
    await send({ venueId: COPPER, message: "Dinner for 40 on 19 Nov 2027, I'm Asha Rao, asha@nimbus.in" });
    const [lead] = await listInquiries(COPPER);
    signIn({ role: "PROPERTY", userId: "eeeeeeee-0002-4000-8000-000000000002", companyId: null, venueId: SAFFRON });
    // The submitted venue is ignored for property managers: they act on their own.
    await assert.rejects(setInquiryStatusAction(form({ inquiry_id: lead.id, venue_id: COPPER, status: "converted" })), /Inquiry not found/);
    signIn({ role: "PROPERTY", userId: "eeeeeeee-0001-4000-8000-000000000001", companyId: null, venueId: COPPER });
    await setInquiryStatusAction(form({ inquiry_id: lead.id, status: "converted" }));
    assert.equal((await readDb()).venueInquiries.find((i) => i.id === lead.id).status, "converted");
    // And the agent won't reopen it.
    await assert.rejects(setInquiryStatusAction(form({ inquiry_id: lead.id, status: "referred" })), /Invalid inquiry update/);
  });
});

describe("migration: venue_inquiries RLS", () => {
  let db;
  const MANAGER = "eeeeeeee-1111-4000-8000-000000000001";
  const OTHER_MANAGER = "eeeeeeee-1111-4000-8000-000000000002";
  const ADMIN = "eeeeeeee-1111-4000-8000-0000000000ad";
  before(async () => {
    db = await createDatabase();
    const { rows: venues } = await db.query("select id from public.venues order by name limit 2");
    for (const [id, role, venue] of [
      [MANAGER, "PROPERTY", venues[0].id],
      [OTHER_MANAGER, "PROPERTY", venues[1].id],
      [ADMIN, "ADMIN", null],
    ]) {
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@x.example`]);
      await db.query("insert into public.platform_users (user_id, role, venue_id) values ($1, $2, $3)", [id, role, venue]);
    }
    await db.query("insert into public.venue_inquiries (venue_id, token_sha256, contact_name) values ($1, $2, 'Asha')", [venues[0].id, "a".repeat(64)]);
    await db.query("insert into public.venue_inquiries (venue_id, token_sha256, contact_name) values ($1, $2, 'Ravi')", [venues[1].id, "b".repeat(64)]);
  });
  const names = (sub) => asUser(db, { claims: { sub } }, async (tx) => (await tx.query("select contact_name from public.venue_inquiries order by contact_name")).rows.map((r) => r.contact_name));

  test("a venue's managers read only their venue's inquiries; admins read all", async () => {
    assert.deepEqual(await names(MANAGER), ["Asha"]);
    assert.deepEqual(await names(OTHER_MANAGER), ["Ravi"]);
    assert.deepEqual(await names(ADMIN), ["Asha", "Ravi"]);
  });

  test("visitors and users can't read or write directly: the API goes through the service role", async () => {
    await assert.rejects(asUser(db, { role: "anon" }, (tx) => tx.query("select * from public.venue_inquiries")), /permission denied/);
    await assert.rejects(asUser(db, { claims: { sub: MANAGER } }, (tx) => tx.query("update public.venue_inquiries set status = 'converted'")), /permission denied/);
    await assert.rejects(db.query("insert into public.venue_inquiries (venue_id, token_sha256) select id, 'short' from public.venues limit 1"), /check constraint/);
  });
});
