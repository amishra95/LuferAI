// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { poLineRef, settlementTimeline } from "../../lib/finance/settlement.ts";
import { createDatabase } from "../support/supabase-pglite.mjs";

test("PO line reference", () => {
  assert.equal(poLineRef("PO-2026-014", 3), "PO-2026-014/L3");
  assert.equal(poLineRef("PO-2026-014", null), "PO-2026-014");
});

test("settlement trail: every money event, oldest first, with tone", () => {
  const t = settlementTimeline({
    booking: {
      created_at: "2026-10-01T09:00:00Z",
      venue_accepted_at: "2026-10-02T12:00:00Z",
      settled_at: "2026-11-10T10:00:00Z",
      expense_reference: "zoho:abc",
      itc_decision: "eligible",
      itc_decided_at: "2026-11-09T10:00:00Z",
      itc_note: "Hotel banquet, 18% with ITC",
    },
    approvals: [
      { status: "APPROVED", decided_at: "2026-10-01T15:00:00Z", approver_name: "Priya", decision_note: null },
      { status: "PENDING", decided_at: null, approver_name: "CFO", decision_note: null },
    ],
    payments: [{ provider: "razorpay", status: "captured", amount_inr: 29_500, created_at: "2026-10-02T13:00:00Z", authorized_at: "2026-10-02T13:01:00Z", captured_at: "2026-10-03T09:00:00Z", voided_at: null }],
    invoices: [{ kind: "balance", invoice_number: "CC/26-27/0042", status: "paid", total_inr: 88_500, issued_at: "2026-11-07T09:00:00Z", paid_at: "2026-11-08T09:00:00Z" }],
    exports: [
      { provider: "concur", status: "failed", attempts: 2, error: "Receiver returned 503", created_at: "2026-11-07T10:00:00Z", updated_at: "2026-11-07T10:05:00Z", requested_by: null },
      { provider: "zoho", status: "delivered", attempts: 1, error: null, created_at: "2026-11-08T10:00:00Z", updated_at: "2026-11-08T10:00:00Z", requested_by: "u1" },
    ],
  });
  assert.deepEqual(
    t.map((e) => [e.kind, e.label, e.tone]),
    [
      ["request", "Booking requested", "neutral"],
      ["approval", "Approved by Priya", "ok"],
      ["venue", "Venue confirmed", "ok"],
      ["payment", "Deposit authorised", "neutral"],
      ["payment", "Payment captured", "ok"],
      ["invoice", "Balance invoice CC/26-27/0042 issued", "neutral"],
      ["export", "Export to SAP Concur failed", "error"],
      ["invoice", "Balance invoice CC/26-27/0042 paid", "ok"],
      ["export", "Exported to Zoho Expense", "ok"],
      ["itc", "ITC confirmed eligible", "ok"],
      ["settled", "Settled", "ok"],
    ]
  );
  assert.equal(t.find((e) => e.kind === "export" && e.tone === "ok").detail, "sent by hand");
  assert.equal(t.find((e) => e.tone === "error").detail, "Receiver returned 503");
});

// --- migration 20261101120000, against PGlite with every migration applied -------------

let db;
before(async () => {
  db = await createDatabase();
});

const NIMBUS = "11111111-1111-4111-8111-111111111111";

test("PO lines: existing allocations are numbered; new ones take the next line; moving PO gives a new line there", async () => {
  const { rows: existing } = await db.query(`select po_id, line_number from po_allocations where line_number is null`);
  assert.deepEqual(existing, []);

  await db.query("begin");
  try {
    const { rows: [po] } = await db.query(
      `insert into purchase_orders (tenant_id, po_number, amount_inr, valid_from, valid_to) values ($1, 'PO-TEST-1', 10000000, '2026-01-01', '2027-12-31') returning id`,
      [NIMBUS]
    );
    const { rows: [other] } = await db.query(
      `insert into purchase_orders (tenant_id, po_number, amount_inr, valid_from, valid_to) values ($1, 'PO-TEST-2', 10000000, '2026-01-01', '2027-12-31') returning id`,
      [NIMBUS]
    );
    const { rows: bookings } = await db.query(
      `select b.id, b.total_amount_inr from bookings b where b.company_id = $1 and b.status <> 'CANCELLED' order by b.created_at limit 2`,
      [NIMBUS]
    );
    assert.equal(bookings.length, 2, "seed has two Nimbus bookings");
    // Free them from their seeded POs (rolled back below).
    await db.query(`delete from po_allocations where booking_id = any($1)`, [bookings.map((b) => b.id)]);
    const lines = [];
    for (const b of bookings) {
      const { rows: [a] } = await db.query(`insert into po_allocations (po_id, tenant_id, booking_id, amount_inr) values ($1, $2, $3, $4) returning line_number`, [po.id, NIMBUS, b.id, b.total_amount_inr]);
      lines.push(a.line_number);
    }
    assert.deepEqual(lines, [1, 2]);

    // Same PO: the line stays; another PO: the next line there.
    const { rows: [same] } = await db.query(`update po_allocations set amount_inr = amount_inr where booking_id = $1 returning line_number`, [bookings[1].id]);
    assert.equal(same.line_number, 2);
    const { rows: [moved] } = await db.query(`update po_allocations set po_id = $1 where booking_id = $2 returning line_number`, [other.id, bookings[1].id]);
    assert.equal(moved.line_number, 1);
  } finally {
    await db.query("rollback");
  }
});

test("exports: one per booking, event and provider; Zoho and ERPNext accepted; unknown providers rejected", async () => {
  const { rows: [b] } = await db.query(`select id, company_id from bookings where company_id = $1 limit 1`, [NIMBUS]);
  const insert = (provider) =>
    db.query(
      `insert into expense_exports (booking_id, tenant_id, event, provider, receipt, payload, payload_sha256, destination, status)
       values ($1, $2, 'booking.confirmed', $3, '{}', '{}', repeat('a', 64), 'mock', 'mocked')`,
      [b.id, b.company_id, provider]
    );
  await db.query("begin");
  try {
    await db.query(`delete from expense_exports where booking_id = $1`, [b.id]);
    await insert("zoho");
    await insert("erpnext");
    // Each expected failure inside a savepoint, so the transaction carries on.
    const fails = async (provider, pattern) => {
      await db.query("savepoint attempt");
      await assert.rejects(insert(provider), pattern);
      await db.query("rollback to savepoint attempt");
    };
    await fails("zoho", /expense_exports_booking_event_provider_key/);
    await fails("netsuite", /expense_exports_provider_check/);
  } finally {
    await db.query("rollback");
  }
  await assert.rejects(db.query(`update companies set expense_provider = 'netsuite' where id = $1`, [NIMBUS]), /companies_expense_provider_check/);
  await db.query(`update companies set expense_provider = 'erpnext' where id = $1`, [NIMBUS]);
  await db.query(`update companies set expense_provider = 'webhook' where id = $1`, [NIMBUS]);
});

test("ITC decision: unreviewed by default; a decision needs its timestamp; only eligible/blocked", async () => {
  const { rows } = await db.query(`select distinct itc_decision from bookings`);
  assert.deepEqual(rows, [{ itc_decision: null }]);
  await assert.rejects(db.query(`update bookings set itc_decision = 'eligible' where company_id = $1`, [NIMBUS]), /bookings_itc_decision_recorded/);
  await assert.rejects(db.query(`update bookings set itc_decision = 'maybe', itc_decided_at = now() where company_id = $1`, [NIMBUS]), /check constraint/);
  await db.query("begin");
  try {
    const { rowCount } = await db.query(`update bookings set itc_decision = 'blocked', itc_decided_at = now(), itc_note = 'Sec. 17(5)' where company_id = $1`, [NIMBUS]);
    assert.ok(rowCount > 0);
  } finally {
    await db.query("rollback");
  }
});
