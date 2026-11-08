// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { conciergeAlertText, RequestUpdate, requestSummary, REQUEST_STATUS_LABEL, statusOf } from "../lib/concierge/requests.ts";

test("requestSummary: a quote names the venue; a brief without facts quotes its start", () => {
  assert.equal(requestSummary({ kind: "quote", venue_name: "Toit", guests: 40, event_date: "2026-12-12", details: null }), "Toit, 40 guests, 12 Dec");
  assert.equal(requestSummary({ kind: "brief", venue_name: null, guests: 25, event_date: null, details: "Team dinner" }), "Event brief, 25 guests");
  const long = "Offsite for the product team somewhere green, close to Whitefield, with a projector";
  assert.match(requestSummary({ kind: "brief", venue_name: null, guests: null, event_date: null, details: long }), /^Event brief: Offsite .{40,}…$/);
});

test("statuses: labels for every status; unknown values read as new", () => {
  assert.equal(REQUEST_STATUS_LABEL[statusOf("options_sent")], "Options sent");
  assert.equal(statusOf("bogus"), "new");
});

test("RequestUpdate: a blank note clears it; long notes and unknown statuses are refused", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(RequestUpdate.parse({ id, status: "working", note: "  " }), { id, status: "working", note: null });
  assert.equal(RequestUpdate.safeParse({ id, status: "working", note: "x".repeat(501) }).success, false);
  assert.equal(RequestUpdate.safeParse({ id, status: "done", note: "" }).success, false);
});

test("the Telegram alert: who, what, budget and the queue link", () => {
  const text = conciergeAlertText(
    { kind: "quote", companyName: "Nimbus", companyId: null, requestedBy: null, requesterEmail: "asha@nimbus.example", venueName: "Toit", eventDate: "2026-12-12", guests: 40, perHeadInr: 2500, details: "Veg-heavy" },
    "https://lufer.app/admin/requests"
  );
  assert.equal(text, "New quote request: Toit\nNimbus · asha@nimbus.example\n12 Dec · 40 guests · ₹2,500/head\nVeg-heavy\nhttps://lufer.app/admin/requests");
});

describe("migration: concierge_requests", () => {
  const NIMBUS = "11111111-1111-4111-8111-111111111111";
  const VERTEX = "22222222-2222-4222-8222-222222222222";
  const CLIENT = "a0000000-0000-4000-8000-0000000000c1";
  const OTHER = "a0000000-0000-4000-8000-0000000000c2";
  const ADMIN = "a0000000-0000-4000-8000-0000000000c3";
  let db;
  let asUser;

  before(async () => {
    const pg = await import("./support/supabase-pglite.mjs");
    asUser = pg.asUser;
    db = await pg.createDatabase();
    for (const id of [CLIENT, OTHER, ADMIN]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@x.example`]);
    await db.query(
      "insert into public.platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $4, 'ORGANIZER'), ($2, 'CLIENT', $5, 'ORGANIZER'), ($3, 'ADMIN', null, null)",
      [CLIENT, OTHER, ADMIN, NIMBUS, VERTEX]
    );
    const ins = "insert into public.concierge_requests (company_id, requested_by, requester_email, kind, venue_name, guests) values ($1, $2, $3, 'quote', 'Toit', 40)";
    await db.query(ins, [NIMBUS, CLIENT, "c@nimbus.example"]);
    await db.query(ins, [VERTEX, OTHER, "o@vertex.example"]);
  });
  after(() => db?.close());

  const as = (sub, fn) => asUser(db, { claims: { sub } }, fn);
  const visible = (sub) => as(sub, async (tx) => (await tx.query("select requester_email from public.concierge_requests order by requester_email")).rows.map((r) => r.requester_email));

  test("a company sees its own requests; admins see all", async () => {
    assert.deepEqual(await visible(CLIENT), ["c@nimbus.example"]);
    assert.deepEqual(await visible(OTHER), ["o@vertex.example"]);
    assert.deepEqual(await visible(ADMIN), ["c@nimbus.example", "o@vertex.example"]);
  });

  test("signed-in users can't write: requests go through the server", async () => {
    await assert.rejects(
      as(CLIENT, (tx) => tx.query("insert into public.concierge_requests (company_id, requester_email, kind, details) values ($1, 'x@y.z', 'brief', 'hi')", [NIMBUS])),
      /permission denied/
    );
    await assert.rejects(as(ADMIN, (tx) => tx.query("update public.concierge_requests set status = 'working'")), /permission denied/);
  });

  test("checks: a quote names its venue; status is one of five", async () => {
    await assert.rejects(db.query("insert into public.concierge_requests (requester_email, kind) values ('x@y.z', 'quote')"), /concierge_requests_quote_has_venue/);
    await assert.rejects(db.query("update public.concierge_requests set status = 'done'"), /check constraint/);
    const { rows } = await db.query("insert into public.concierge_requests (requester_email, kind, details) values ('x@y.z', 'brief', 'Team lunch') returning status, company_id");
    assert.deepEqual(rows[0], { status: "new", company_id: null });
  });
});
