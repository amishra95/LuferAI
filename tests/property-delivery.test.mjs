/**
 * Property managers and live booking delivery, end to end against the real
 * schema (every migration + seed, in PGlite):
 *
 *   admin links a manager to a venue (platform_users, as lib/admin/property-managers.ts)
 *   → an in-policy request is priced, policy-checked and routed with the same pure
 *     functions placeBookingRequest uses → it starts "With the venue" (PENDING)
 *   → the manager reads it through RLS, and the live "booking" event reaches them
 *     (the stream's host audience) and nobody else's venue
 *   → over-policy requests stay hidden from the venue until signed off
 *   → moving the manager to another venue moves what they see, at once
 *   → the manager accepts: CONFIRMED, venue_accepted_at stamped, the requester's
 *     company reads it and hears the live event; the confirmation email is built.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { normalizePhone, parseManagerInput } from "../lib/admin/property-manager-input.ts";
import { initialStatus } from "../lib/bookings/lifecycle.ts";
import { diffBookings, venueAcceptances } from "../lib/bookings/live.ts";
import { calculateGst } from "../lib/gst-engine.ts";
import { bookingAcceptedMessage } from "../lib/notifications/booking-accepted.ts";
import { evaluateBookingPolicy, monthToDateSpend } from "../lib/policies/evaluate-booking-policy.ts";
import { applyRateCard, isRateCardActive } from "../lib/rates/apply-rate-card.ts";
import { approvalDemand, matchRule } from "../lib/services/enterprise/approvalEngine.ts";
import { parseTelemetryEvent, visibleTo } from "../lib/telemetry/events.ts";
import { minSpendCompliance } from "../lib/venues/profile.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const COPPER = "aaaaaaaa-0001-4000-8000-000000000001";
const MOSAIC = "aaaaaaaa-0003-4000-8000-000000000003";
const MANAGER = "c0000000-0000-4000-8000-0000000000a1";
const OTHER_MANAGER = "c0000000-0000-4000-8000-0000000000a2";
const ORGANIZER = "c0000000-0000-4000-8000-0000000000b1";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const VERTEX_ORGANIZER = "c0000000-0000-4000-8000-0000000000b2";
const EVENT_DATE = "2027-03-18";

let db;
const num = (v) => (v === null ? null : Number(v));

before(async () => {
  db = await createDatabase();
  await db.query(`insert into auth.users (id, email) values ($1, 'mosaic.gm@example.test'), ($2, 'copper.gm@example.test')`, [MANAGER, OTHER_MANAGER]);
  // What addPropertyManager inserts once the invite exists.
  await db.query(`insert into platform_users (user_id, role, venue_id) values ($1, 'PROPERTY', $2), ($3, 'PROPERTY', $4)`, [MANAGER, MOSAIC, OTHER_MANAGER, COPPER]);
  await db.query(`insert into auth.users (id, email) values ($1, 'priya@nimbus.example'), ($2, 'ea@vertex.example')`, [ORGANIZER, VERTEX_ORGANIZER]);
  await db.query(`insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $2, 'ORGANIZER'), ($3, 'CLIENT', $4, 'ORGANIZER')`, [
    ORGANIZER,
    NIMBUS,
    VERTEX_ORGANIZER,
    VERTEX,
  ]);
});

/** placeBookingRequest's pricing, minimum-spend, policy and routing steps, on the seeded data. */
async function route({ partySize, perHead }) {
  const venue = (await db.query(`select * from venues where id = $1`, [MOSAIC])).rows[0];
  const cards = (await db.query(`select * from corporate_rate_cards where tenant_id = $1 and venue_id = $2`, [NIMBUS, MOSAIC])).rows.map((c) => ({
    ...c,
    discount_percentage: Number(c.discount_percentage),
    custom_per_head_rate: num(c.custom_per_head_rate),
    minimum_spend_override: num(c.minimum_spend_override),
    effective_from: String(c.effective_from instanceof Date ? c.effective_from.toISOString().slice(0, 10) : c.effective_from),
    effective_to: c.effective_to && String(c.effective_to instanceof Date ? c.effective_to.toISOString().slice(0, 10) : c.effective_to),
  }));
  const card = cards.find((c) => isRateCardActive(c, EVENT_DATE)) ?? null;
  const pricing = applyRateCard(card, { partySize, perHead, venueMinSpend: Number(venue.min_spend_inr) });
  const perGuest = minSpendCompliance({ partySize, perHead: pricing.negotiatedPerHead, minimumSpend: 0, minimumPerHead: Number(venue.min_spend_per_head_inr) });
  if (!pricing.meetsMinimumSpend || !perGuest.ok) return { rejected: "below the venue's minimum spend", pricing };

  const policyRow = (await db.query(`select * from corporate_policies where tenant_id = $1`, [NIMBUS])).rows[0];
  const company = (await db.query(`select monthly_spend_limit_inr from companies where id = $1`, [NIMBUS])).rows[0];
  const others = (await db.query(`select id, company_id, event_date::text, status, total_amount_inr from bookings`)).rows;
  const rules = (await db.query(`select * from approval_policy_rules where tenant_id = $1`, [NIMBUS])).rows.map((r) => ({
    ...r,
    min_amount_inr: Number(r.min_amount_inr),
    max_amount_inr: num(r.max_amount_inr),
  }));
  const policy = evaluateBookingPolicy(
    {
      max_budget_per_head: num(policyRow.max_budget_per_head),
      requires_approval_above: num(policyRow.requires_approval_above),
      high_value_threshold: num(policyRow.high_value_threshold),
      alcohol_policy: policyRow.alcohol_policy,
      restricted_entertainment: policyRow.restricted_entertainment,
    },
    { total_amount: pricing.taxableTotal, headcount: partySize, per_head_amount: pricing.negotiatedPerHead },
    { monthly_limit: Number(company.monthly_spend_limit_inr), month_to_date: monthToDateSpend(others, NIMBUS, EVENT_DATE) }
  );
  const demand = approvalDemand({ policy, amount: pricing.taxableTotal, rule: matchRule(rules, { tenantId: NIMBUS, departmentId: null, amount: pricing.taxableTotal }) });
  return { pricing, demand, status: initialStatus(demand.required ? demand.levels : 0) };
}

async function insertBooking({ partySize, pricing, status }) {
  // requested_by: what placeBookingRequest records (the filing employee).
  const { rows } = await db.query(
    `insert into bookings (company_id, venue_id, party_size, budget_per_head_inr, total_amount_inr, status, event_date, requested_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [NIMBUS, MOSAIC, partySize, pricing.negotiatedPerHead, pricing.taxableTotal, status, EVENT_DATE, ORGANIZER]
  );
  return rows[0].id;
}

/** Bookings with these ids the user can read through RLS. */
const visibleIds = (user, ids) =>
  asUser(db, { claims: { sub: user } }, async (tx) => (await tx.query(`select id from bookings where id = any($1::uuid[])`, [ids])).rows.map((r) => r.id));

/** The live stream's audience for a signed-in user (app/api/telemetry/stream/route.ts). */
async function audienceFor(user) {
  const row = (await db.query(`select role, venue_id from platform_users where user_id = $1`, [user])).rows[0];
  const company = (await db.query(`select company_id from platform_users where user_id = $1`, [user])).rows[0].company_id;
  return { ops: row.role === "ADMIN", venues: false, venueId: row.role === "PROPERTY" ? row.venue_id : null, companyId: row.role === "CLIENT" ? company : null };
}

test("an in-policy request goes straight to the venue: its manager reads it and gets the live event", async () => {
  // 40 guests asking ₹2,500/head: Nimbus's Mosaic rate card prices it at ₹1,600 (₹64,000),
  // above the ₹50k minimum, under the ₹2,500/head cap and the ₹1.5L sign-off threshold.
  const routed = await route({ partySize: 40, perHead: 2500 });
  assert.equal(routed.rejected, undefined);
  assert.equal(routed.pricing.negotiatedPerHead, 1600);
  assert.equal(routed.pricing.taxableTotal, 64000);
  assert.equal(routed.demand.required, false);
  assert.equal(routed.status, "PENDING"); // "With the venue"

  const id = await insertBooking({ partySize: 40, pricing: routed.pricing, status: routed.status });
  assert.deepEqual(await visibleIds(MANAGER, [id]), [id]);
  assert.deepEqual(await visibleIds(OTHER_MANAGER, [id]), []);

  // The event placeBookingRequest publishes, as it travels through Redis to the stream.
  const event = parseTelemetryEvent(JSON.stringify({ seq: 1, at: 1, type: "booking", bookingId: id, venueId: MOSAIC, status: routed.status, by: "request" }));
  assert.ok(event);
  assert.equal(visibleTo(event, await audienceFor(MANAGER)), true);
  assert.equal(visibleTo(event, await audienceFor(OTHER_MANAGER)), false);
});

test("10 guests at ₹2,500/head is rejected for Mosaic's minimum spend, so nothing reaches the venue", async () => {
  const routed = await route({ partySize: 10, perHead: 2500 });
  assert.equal(routed.rejected, "below the venue's minimum spend");
  assert.equal(routed.pricing.taxableTotal, 16000); // the negotiated ₹1,600/head
});

test("an over-policy request waits for sign-off, hidden from the venue (rows and live events)", async () => {
  // 120 × ₹1,600 = ₹1,92,000: above Nimbus's ₹1.5L threshold.
  const routed = await route({ partySize: 120, perHead: 2500 });
  assert.equal(routed.demand.required, true);
  assert.equal(routed.status, "PENDING_APPROVAL");
  const id = await insertBooking({ partySize: 120, pricing: routed.pricing, status: routed.status });
  assert.deepEqual(await visibleIds(MANAGER, [id]), []);
  const event = { type: "booking", bookingId: id, venueId: MOSAIC, status: routed.status, by: "request" };
  assert.equal(visibleTo(event, await audienceFor(MANAGER)), false);

  // Once approved it moves to the venue's inbox.
  await db.query(`update bookings set status = 'PENDING' where id = $1`, [id]);
  assert.deepEqual(await visibleIds(MANAGER, [id]), [id]);
  assert.equal(visibleTo({ ...event, status: "PENDING" }, await audienceFor(MANAGER)), true);
});

test("moving a manager to another venue moves their inbox and live events at once", async () => {
  const routed = await route({ partySize: 40, perHead: 2500 });
  const id = await insertBooking({ partySize: 40, pricing: routed.pricing, status: routed.status });
  // What assignVenue does.
  await db.query(`update platform_users set venue_id = $2 where user_id = $1 and role = 'PROPERTY'`, [MANAGER, COPPER]);
  try {
    assert.deepEqual(await visibleIds(MANAGER, [id]), []);
    assert.equal(visibleTo({ type: "booking", venueId: MOSAIC, status: "PENDING" }, await audienceFor(MANAGER)), false);
    assert.equal(visibleTo({ type: "booking", venueId: COPPER, status: "PENDING" }, await audienceFor(MANAGER)), true);
  } finally {
    await db.query(`update platform_users set venue_id = $2 where user_id = $1`, [MANAGER, MOSAIC]);
  }
});

test("a property manager must be linked to a venue (schema)", async () => {
  await db.query(`insert into auth.users (id, email) values ('c0000000-0000-4000-8000-0000000000a3', 'x@example.test')`);
  await assert.rejects(db.query(`insert into platform_users (user_id, role) values ('c0000000-0000-4000-8000-0000000000a3', 'PROPERTY')`), /platform_users_scope_check/);
});

test("manager form: email, name, phone and venue are validated and normalised", () => {
  const ok = parseManagerInput({ email: " GM@Mosaic.Example ", name: "  Priya   Nair ", phone: "098450 12345", venue_id: MOSAIC });
  assert.deepEqual(ok, { ok: true, value: { email: "gm@mosaic.example", name: "Priya Nair", phone: "+919845012345", venueId: MOSAIC } });
  const bad = parseManagerInput({ email: "nope", name: "P", phone: "12", venue_id: "mosaic" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["email", "name", "phone", "venue_id"]);
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone("+91 98450-12345"), "+919845012345");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
});

test("the manager accepts: CONFIRMED with venue_accepted_at, the requester's company sees it and hears it live", async () => {
  const routed = await route({ partySize: 40, perHead: 2500 });
  const id = await insertBooking({ partySize: 40, pricing: routed.pricing, status: routed.status });
  assert.equal((await db.query(`select requested_by from bookings where id = $1`, [id])).rows[0].requested_by, ORGANIZER);

  const seen = await db.transaction(async (tx) => {
    const as = async (user) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "authenticated", sub: user })]);
      await tx.exec(`set local role authenticated`);
    };
    // The venue's Confirm, through its own RLS ("property updates own bookings").
    await as(MANAGER);
    const updated = await tx.query(`update bookings set status = 'CONFIRMED' where id = $1 returning status, venue_accepted_at`, [id]);
    // The requester's company reads the result; another company can't.
    await as(ORGANIZER);
    const client = (await tx.query(`select status, venue_accepted_at from bookings where id = $1`, [id])).rows;
    await as(VERTEX_ORGANIZER);
    const other = (await tx.query(`select id from bookings where id = $1`, [id])).rows;
    await tx.rollback();
    return { updated: updated.rows, client, other };
  });
  assert.equal(seen.updated.length, 1);
  assert.equal(seen.updated[0].status, "CONFIRMED");
  assert.ok(seen.updated[0].venue_accepted_at, "venue_accepted_at is stamped by the trigger");
  assert.equal(seen.client[0].status, "CONFIRMED");
  assert.ok(seen.client[0].venue_accepted_at);
  assert.deepEqual(seen.other, []);

  // respondToBooking's event: the booking's company hears it, other companies don't.
  const event = parseTelemetryEvent(JSON.stringify({ seq: 9, at: 9, type: "booking", bookingId: id, venueId: MOSAIC, status: "CONFIRMED", by: "venue", companyId: NIMBUS }));
  assert.ok(event);
  assert.equal(event.companyId, NIMBUS);
  assert.equal(visibleTo(event, await audienceFor(ORGANIZER)), true);
  assert.equal(visibleTo(event, await audienceFor(VERTEX_ORGANIZER)), false);
  assert.equal(visibleTo(event, await audienceFor(MANAGER)), true);
  assert.equal(visibleTo(event, await audienceFor(OTHER_MANAGER)), false);

  // The client portal's poll then sees the change and celebrates it.
  const before = [{ id, status: "PENDING", venue: "Mosaic Kitchen & Bar", eventDate: EVENT_DATE }];
  const after = [{ ...before[0], status: "CONFIRMED" }];
  assert.deepEqual(venueAcceptances(diffBookings(before, after)), [{ id, title: "Mosaic Kitchen & Bar confirmed your booking!" }]);
  assert.deepEqual(venueAcceptances(diffBookings(after, after)), []);
});

test("venue_accepted_at is only stamped once, on the first move to CONFIRMED", async () => {
  const routed = await route({ partySize: 40, perHead: 2500 });
  const id = await insertBooking({ partySize: 40, pricing: routed.pricing, status: "PENDING" });
  await db.query(`update bookings set notes = 'unrelated edit' where id = $1`, [id]);
  assert.equal((await db.query(`select venue_accepted_at from bookings where id = $1`, [id])).rows[0].venue_accepted_at, null);
  await db.query(`update bookings set status = 'CONFIRMED' where id = $1`, [id]);
  const first = (await db.query(`select venue_accepted_at from bookings where id = $1`, [id])).rows[0].venue_accepted_at;
  assert.ok(first);
  await db.query(`update bookings set status = 'COMPLETED' where id = $1`, [id]);
  assert.deepEqual((await db.query(`select venue_accepted_at from bookings where id = $1`, [id])).rows[0].venue_accepted_at, first);
});

test("the confirmation email: subject, summary, locked price, GST breakdown and the voucher link", () => {
  const invoice = calculateGst({ total_amount: 64000, company_gstin: "29AABCN4821K1ZA", venue_gstin: "29AAGCM3382R1ZM" });
  const m = bookingAcceptedMessage({
    bookingId: "4f3c2b1a-0000-4000-8000-000000000001",
    venueName: "Mosaic Kitchen & Bar",
    venueArea: "Koramangala, Bengaluru",
    eventDate: EVENT_DATE,
    partySize: 40,
    perHead: 1600,
    companyName: "Nimbus Analytics Private Limited",
    invoice,
    bookingUrl: "https://lufer-ai.vercel.app/client/events/b1",
    recipientName: "Priya",
  });
  assert.equal(m.subject, "Good news! Mosaic Kitchen & Bar has accepted your event request for Thu, 18 Mar 2027");
  for (const line of ["Booking ID: 4F3C2B1A (4f3c2b1a-0000-4000-8000-000000000001)", "Venue: Mosaic Kitchen & Bar, Koramangala, Bengaluru", "Date: Thu, 18 Mar 2027", "Guests: 40", "Per head (locked): ₹1,600.00", "Taxable value: ₹64,000.00", "CGST 9%: ₹5,760.00", "SGST 9%: ₹5,760.00", "Invoice total: ₹75,520.00"]) {
    assert.ok(m.text.includes(line), line);
  }
  assert.ok(m.text.includes("https://lufer-ai.vercel.app/client/events/b1"));
  assert.ok(m.html.includes("Mosaic Kitchen &amp; Bar accepted your event request"));
  assert.ok(m.html.includes('href="https://lufer-ai.vercel.app/client/events/b1"'));
  assert.ok(!m.text.includes("IGST"));
});

test("bookings keep the requester's mobile in E.164 (and refuse anything else)", async () => {
  const row = (phone) =>
    db.query(
      `insert into bookings (company_id, venue_id, party_size, budget_per_head_inr, total_amount_inr, status, event_date, requested_by, requested_by_phone)
       values ($1, $2, 40, 1600, 64000, 'PENDING', $3, $4, $5) returning requested_by_phone`,
      [NIMBUS, MOSAIC, EVENT_DATE, ORGANIZER, phone]
    );
  assert.equal((await row(normalizePhone("98450 12345"))).rows[0].requested_by_phone, "+919845012345");
  assert.equal((await row(null)).rows[0].requested_by_phone, null);
  await assert.rejects(row("98450 12345"), /bookings_requested_by_phone_e164/);
});
