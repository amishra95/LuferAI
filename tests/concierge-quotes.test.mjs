// Run with: npm test
//
// Concierge quotes (lib/concierge/requests.ts): Lufer sends a price on a
// request, the company accepts and pays it; and migration 20261119000000 in
// Postgres (PGlite): the 'quoted' status, a complete quote, and a payment that
// belongs to a request.
import { before, test } from "node:test";
import assert from "node:assert/strict";

import {
  acceptedAlert,
  acceptRefusal,
  isPayableRequest,
  isQuotable,
  isWithdrawable,
  MANUAL_STATUSES,
  mayAcceptQuote,
  paidAlert,
  QuoteInput,
  quoteEmail,
  quoteLine,
  REQUEST_STATUS_LABEL,
  RequestUpdate,
} from "../lib/concierge/requests.ts";
import { requestReceiptModel, documentHtml } from "../lib/finance/tax-invoice-document.ts";
import { renderDocumentPdf } from "../lib/finance/document-pdf.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const ID = "11111111-1111-4111-8111-111111111111";
const CO = "22222222-2222-4222-8222-222222222222";
const requester = { role: "CLIENT", userId: "u-req", companyId: CO, corporateRole: "ORGANIZER" };
const quoted = { company_id: CO, requested_by: "u-req", status: "quoted", quote_total_inr: 94400 };

test("QuoteInput: venue, date, guests and a total to the paisa; a blank note is none", () => {
  const ok = { id: ID, venueName: " Vesparo ", eventDate: "2026-12-12", guests: 40, totalInr: 94400, note: "  " };
  assert.deepEqual(QuoteInput.parse(ok), { id: ID, venueName: "Vesparo", eventDate: "2026-12-12", guests: 40, totalInr: 94400, note: null });
  assert.equal(QuoteInput.parse({ ...ok, totalInr: 94400.5, note: "₹2,000 a head + 18%" }).note, "₹2,000 a head + 18%");
  for (const bad of [{ totalInr: 0 }, { totalInr: -5 }, { totalInr: 10.001 }, { totalInr: NaN }, { guests: 0 }, { guests: 2.5 }, { eventDate: "12 Dec" }, { venueName: " " }, { note: "x".repeat(501) }]) {
    assert.equal(QuoteInput.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad));
  }
});

test("statuses: 'Quote sent' exists, is set only by sending a quote, and can still be withdrawn or re-quoted", () => {
  assert.equal(REQUEST_STATUS_LABEL.quoted, "Quote sent");
  assert.ok(!MANUAL_STATUSES.includes("quoted"));
  assert.equal(RequestUpdate.safeParse({ id: ID, status: "quoted", note: "" }).success, false, "not by hand");
  assert.equal(RequestUpdate.safeParse({ id: ID, status: "booked", note: "" }).success, true);
  assert.deepEqual(["new", "working", "options_sent", "quoted", "booked", "closed"].map(isQuotable), [true, true, true, true, false, false]);
  assert.equal(isWithdrawable("quoted"), true);
  assert.equal(isWithdrawable("booked"), false, "an accepted quote isn't withdrawn in the app");
});

test("accepting: the requester or an Approver of that company, on an open quote only", () => {
  assert.equal(acceptRefusal(requester, quoted), null);
  assert.equal(acceptRefusal({ ...requester, userId: "u-boss", corporateRole: "APPROVER" }, quoted), null);
  assert.match(acceptRefusal({ ...requester, userId: "u-other" }, quoted), /Only the person who sent this request/);
  assert.match(acceptRefusal({ ...requester, userId: "u-fin", corporateRole: "FINANCE" }, quoted), /Only the person/);
  assert.match(acceptRefusal({ ...requester, companyId: "another" }, quoted), /Only the person/);
  assert.match(acceptRefusal({ role: "ADMIN", userId: "a", companyId: null, corporateRole: null }, quoted), /company accepts its own quote/);
  assert.match(acceptRefusal(requester, { ...quoted, status: "booked" }), /already accepted/);
  assert.match(acceptRefusal(requester, { ...quoted, status: "working" }), /no open quote/);
  assert.match(acceptRefusal(requester, { ...quoted, status: "closed" }), /no open quote/);
  assert.match(acceptRefusal(requester, { ...quoted, quote_total_inr: null }), /no open quote/);
  assert.equal(mayAcceptQuote({ role: "PROPERTY", userId: "v", companyId: null, corporateRole: null }, quoted), false);
});

test("paying: only an accepted quote", () => {
  const accepted = { status: "booked", quote_total_inr: 94400, accepted_at: "2026-11-16T10:00:00Z" };
  assert.equal(isPayableRequest(accepted), true);
  assert.equal(isPayableRequest({ ...accepted, status: "quoted", accepted_at: null }), false, "not before accepting");
  assert.equal(isPayableRequest({ ...accepted, accepted_at: null }), false, "booked by hand, without a quote accepted");
  assert.equal(isPayableRequest({ ...accepted, quote_total_inr: null }), false);
  assert.equal(isPayableRequest({ ...accepted, status: "closed" }), false);
});

test("the quote in words: total, guests and per head; emails to the company and to Lufer", () => {
  const r = { venue_name: "Vesparo", event_date: "2026-12-12", guests: 40, quote_total_inr: 94400, quote_note: "Set menu, soft drinks" };
  assert.equal(quoteLine(r), "₹94,400 for 40 guests (₹2,360 a head)");
  assert.equal(quoteLine({ quote_total_inr: 50000, guests: null }), "₹50,000");
  assert.equal(quoteLine({ quote_total_inr: null, guests: 40 }), null);

  const mail = quoteEmail(r, "https://lufer.app/client");
  assert.equal(mail.subject, "Your quote for Vesparo, 12 Dec");
  assert.ok(mail.lines.includes("Total: ₹94,400 for 40 guests (₹2,360 a head), all taxes and charges included."));
  assert.ok(mail.lines.includes("Set menu, soft drinks"));
  assert.ok(mail.lines.at(-1).endsWith("https://lufer.app/client"));

  const ops = acceptedAlert(r, { companyName: "Nimbus", email: "asha@nimbus.example" });
  assert.equal(ops.subject, "Quote accepted: Nimbus at Vesparo, 12 Dec");
  assert.match(ops.lines.join("\n"), /asha@nimbus\.example at Nimbus accepted the quote/);
  assert.match(ops.lines.join("\n"), /confirm the booking with the venue/);
  const paid = paidAlert(r, { companyName: "Nimbus" }, "pay_9");
  assert.equal(paid.subject, "Paid: Nimbus at Vesparo, 12 Dec");
  assert.match(paid.lines.join("\n"), /Nimbus paid ₹94,400 for Vesparo\.\nPayment pay_9/);
});

test("the receipt: from Lufer for the venue, the amount in words, and plainly not a tax invoice", async () => {
  const model = requestReceiptModel({
    receivedBy: "Lufer",
    requestId: ID,
    paidOn: "2026-12-13",
    venueName: "Vesparo",
    eventDate: "2026-12-12",
    guests: 40,
    companyName: "Nimbus Analytics Private Limited",
    companyGstin: "29AABCN4821K1ZA",
    companyAddress: "4th Floor, Prestige Tech Park, Bengaluru 560103",
    paid: 94400,
    quoteNote: "Set menu, soft drinks",
    paymentRef: "pay_9",
  });
  const html = documentHtml(model);
  assert.match(html, /<h1>Payment Receipt<\/h1>/);
  assert.match(html, /Event at Vesparo · on 2026-12-12 · 40 guests<\/td><td class="num">₹94,400\.00/);
  assert.match(html, /Amount in words: Rupees Ninety Four Thousand Four Hundred Only/);
  assert.match(html, /not a tax invoice/);
  assert.match(html, /For Vesparo/);
  assert.match(html, /GSTIN 29AABCN4821K1ZA/);
  assert.doesNotMatch(html, /Tax Invoice|CGST|IGST/, "no GST lines: Lufer isn't the supplier on record");
  const bare = documentHtml(requestReceiptModel({ receivedBy: "Lufer", requestId: ID, paidOn: "2026-12-13", venueName: "Vesparo", eventDate: null, guests: null, companyName: "Nimbus", companyGstin: null, companyAddress: null, paid: 500.5, quoteNote: null, paymentRef: null }));
  assert.match(bare, /Event at Vesparo<\/td>/);
  assert.doesNotMatch(bare, /GSTIN|Quote:/);
  assert.equal(Buffer.from((await renderDocumentPdf(model)).slice(0, 5)).toString("latin1"), "%PDF-");
});

// --- Postgres ---------------------------------------------------------------------------------

let db;
let company;
let other;
let booking;
before(async () => {
  db = await createDatabase();
  [company, other] = (await db.query(`select id from public.companies order by id limit 2`)).rows.map((r) => r.id);
  booking = (await db.query(`select id from public.bookings order by id limit 1`)).rows[0].id;
});

const request = (tx, extra = {}) => {
  const row = { company_id: company, requester_email: "asha@nimbus.example", kind: "quote", venue_name: "Vesparo", event_date: "2026-12-12", guests: 40, ...extra };
  const keys = Object.keys(row);
  return tx.query(`insert into concierge_requests (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(row)).then((r) => r.rows[0].id);
};
const pay = (tx, subject, status = "captured") =>
  tx.query(
    `insert into payments (${Object.keys(subject).join(", ")}, purpose, provider, status, amount_inr, deposit_rate, provider_order_id, invoice)
     values (${Object.keys(subject).map((_, i) => `$${i + 1}`).join(", ")}, 'request', 'razorpay', '${status}', 94400, 1, gen_random_uuid()::text, '{}') returning id`,
    Object.values(subject)
  );
const scratch = async (fn) => {
  await db.query("begin");
  try {
    await fn(db);
  } finally {
    await db.query("rollback");
  }
};
const rejects = async (tx, promise, pattern) => {
  await tx.query("savepoint s");
  await assert.rejects(promise(), pattern);
  await tx.query("rollback to savepoint s");
};

test("db: a quoted request has a venue, a date, guests and a total", async () => {
  await scratch(async (tx) => {
    const id = await request(tx);
    await rejects(tx, () => tx.query(`update concierge_requests set status = 'quoted' where id = $1`, [id]), /concierge_requests_quote_complete/);
    await rejects(tx, () => tx.query(`update concierge_requests set status = 'quoted', quote_total_inr = 0 where id = $1`, [id]), /quote_total_inr/);
    await tx.query(`update concierge_requests set status = 'quoted', quote_total_inr = 94400, quoted_at = now() where id = $1`, [id]);
    await rejects(tx, () => tx.query(`update concierge_requests set event_date = null where id = $1`, [id]), /concierge_requests_quote_complete/);
    await tx.query(`update concierge_requests set status = 'booked', accepted_at = now() where id = $1`, [id]);
    await rejects(tx, () => tx.query(`update concierge_requests set status = 'paid' where id = $1`, [id]), /concierge_requests_status_check/);
  });
});

test("db: a payment is for exactly one thing; a request has one live payment and can't be deleted from under it", async () => {
  await scratch(async (tx) => {
    const id = await request(tx, { status: "booked", quote_total_inr: 94400 });
    await rejects(tx, () => pay(tx, { concierge_request_id: id, booking_id: booking }), /payments_subject_check/);
    await rejects(tx, () => tx.query(`insert into payments (purpose, provider, amount_inr, deposit_rate, provider_order_id, invoice) values ('request', 'razorpay', 1, 1, 'x', '{}')`), /payments_subject_check/);
    await pay(tx, { concierge_request_id: id }, "failed"); // a failed try doesn't block the next
    await pay(tx, { concierge_request_id: id }, "captured");
    await rejects(tx, () => pay(tx, { concierge_request_id: id }, "authorized"), /payments_one_live_per_request/);
    await rejects(tx, () => tx.query(`delete from concierge_requests where id = $1`, [id]), /payments_concierge_request_id_fkey/);
  });
});

test("db: a company reads the payments on its own requests, and nobody else's", async () => {
  const id = await request(db, { status: "booked", quote_total_inr: 94400 });
  const { rows } = await pay(db, { concierge_request_id: id });
  const mine = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const theirs = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  await db.query(`insert into auth.users (id, email) values ($1, 'mine@a.example'), ($2, 'theirs@b.example')`, [mine, theirs]);
  await db.query(`insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $3, 'ORGANIZER'), ($2, 'CLIENT', $4, 'ORGANIZER')`, [mine, theirs, company, other]);
  const seen = (sub) => asUser(db, { claims: { sub } }, async (tx) => (await tx.query(`select id from payments where id = $1`, [rows[0].id])).rows.length);
  assert.equal(await seen(mine), 1, "its own company");
  assert.equal(await seen(theirs), 0, "another company");
  await db.query(`delete from payments where id = $1`, [rows[0].id]);
  await db.query(`delete from concierge_requests where id = $1`, [id]);
});
