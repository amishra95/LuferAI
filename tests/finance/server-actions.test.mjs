// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// The Sprint 3 finance server actions end to end, against the in-memory mock
// store (lib/data/mock-store.ts) with the session stubbed: setItcDecision and
// exportBookingToERP (app/(dashboard)/client/actions.ts).
import { signIn } from "../support/server-actions.mjs";
import { after, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { PROVIDER_ENV } from "../../lib/finance/expense-adapters.ts";

// No provider endpoints: every export is recorded without being sent.
for (const names of Object.values(PROVIDER_ENV)) for (const list of Object.values(names)) for (const n of list) delete process.env[n];

const { exportBookingToERP, setItcDecision } = await import("../../app/(dashboard)/client/actions.ts");
const { findExpenseExport, listBookings } = await import("../../lib/data/index.ts");
const { receiptState } = await import("../../lib/bookings/expense-meta.ts");

// Seed data (lib/data/mock-store.ts).
const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
/** Vertex, COMPLETED and invoiced: its ITC is up for review. */
const ITC_BOOKING = "bbbbbbbb-0002-4000-8000-000000000002";
/** Nimbus, CONFIRMED: ready to export. */
const EXPORT_BOOKING = "bbbbbbbb-0001-4000-8000-000000000001";
const USERS = {
  vertexApprover: { userId: "dddddddd-0004-4000-8000-000000000004", companyId: VERTEX },
  vertexOrganizer: { userId: "dddddddd-0003-4000-8000-000000000003", companyId: VERTEX },
  vertexFinanceViewer: { userId: "dddddddd-0008-4000-8000-000000000008", companyId: VERTEX },
  nimbusApprover: { userId: "dddddddd-0002-4000-8000-000000000002", companyId: NIMBUS },
  nimbusOrganizer: { userId: "dddddddd-0001-4000-8000-000000000001", companyId: NIMBUS },
  nimbusFinanceViewer: { userId: "dddddddd-0006-4000-8000-000000000006", companyId: NIMBUS },
};
const ADMIN_ID = "eeeeeeee-0001-4000-8000-000000000001";

const asClient = (user) => signIn({ role: "CLIENT", ...user });
const asAdmin = () => signIn({ role: "ADMIN", userId: ADMIN_ID, companyId: null });
const bookingById = async (id) => (await listBookings()).find((b) => b.id === id);

/** The expense_export audit lines the dispatcher logged (one JSON object per console.info). */
let auditLines = [];
beforeEach(() => {
  auditLines = [];
  mock.method(console, "info", (line) => {
    try {
      const entry = JSON.parse(line);
      if (entry.audit === "expense_export") auditLines.push(entry);
    } catch {}
  });
});
after(() => signIn(null));

// ----------------------------------------------------------------------------
// setItcDecision
// ----------------------------------------------------------------------------

test("setItcDecision: an Approver marks ITC eligible, blocked, and back to review (null)", async () => {
  asClient(USERS.vertexApprover);
  for (const decision of ["eligible", "blocked", null]) {
    const result = await setItcDecision(ITC_BOOKING, decision, decision ? `Marked ${decision}` : undefined);
    assert.deepEqual(result, { ok: true, data: { bookingId: ITC_BOOKING, decision } }, String(decision));
    assert.equal((await bookingById(ITC_BOOKING)).itc_decision, decision);
  }
});

test("setItcDecision: an admin can decide for any company", async () => {
  asAdmin();
  assert.deepEqual(await setItcDecision(ITC_BOOKING, "eligible"), { ok: true, data: { bookingId: ITC_BOOKING, decision: "eligible" } });
  assert.equal((await bookingById(ITC_BOOKING)).itc_decision, "eligible");
  await setItcDecision(ITC_BOOKING, null);
});

test("setItcDecision: Organizers and Finance viewers are refused and nothing changes", async () => {
  for (const user of [USERS.vertexOrganizer, USERS.vertexFinanceViewer]) {
    asClient(user);
    const result = await setItcDecision(ITC_BOOKING, "blocked");
    assert.deepEqual(result, { ok: false, error: "Only Approvers (or admins) can review input tax credit." }, user.userId);
  }
  assert.equal((await bookingById(ITC_BOOKING)).itc_decision, null);
});

test("setItcDecision: an Approver can't reach another company's booking", async () => {
  asClient(USERS.nimbusApprover);
  assert.deepEqual(await setItcDecision(ITC_BOOKING, "eligible"), { ok: false, error: "Booking not found." });
});

test("setItcDecision: rejects unknown decisions and bookings not yet invoiced", async () => {
  asClient(USERS.vertexApprover);
  assert.deepEqual(await setItcDecision(ITC_BOOKING, "pending"), { ok: false, error: "Unknown ITC decision." });
  asClient(USERS.nimbusApprover);
  assert.deepEqual(await setItcDecision(EXPORT_BOOKING, "eligible"), { ok: false, error: "Decide ITC once the event is completed and invoiced." });
});

test("setItcDecision: records who decided and when, with the note; clearing it wipes all three", async () => {
  asClient(USERS.vertexApprover);
  const before = Date.now();
  await setItcDecision(ITC_BOOKING, "blocked", "  Sec. 17(5): food and beverages  ");
  const decided = await bookingById(ITC_BOOKING);
  assert.equal(decided.itc_decided_by, USERS.vertexApprover.userId);
  assert.ok(Date.parse(decided.itc_decided_at) >= before && Date.parse(decided.itc_decided_at) <= Date.now(), decided.itc_decided_at);
  assert.equal(decided.itc_note, "Sec. 17(5): food and beverages");

  await setItcDecision(ITC_BOOKING, null);
  const cleared = await bookingById(ITC_BOOKING);
  assert.deepEqual([cleared.itc_decision, cleared.itc_decided_by, cleared.itc_decided_at, cleared.itc_note], [null, null, null, null]);
});

// ----------------------------------------------------------------------------
// exportBookingToERP
// ----------------------------------------------------------------------------

test("exportBookingToERP: Organizers and Finance viewers are refused and nothing is recorded", async () => {
  for (const user of [USERS.nimbusOrganizer, USERS.nimbusFinanceViewer]) {
    asClient(user);
    assert.deepEqual(await exportBookingToERP(EXPORT_BOOKING, "zoho"), { ok: false, error: "Only Approvers (or admins) can export bookings to finance systems." });
  }
  assert.equal(await findExpenseExport(EXPORT_BOOKING, "booking.confirmed", "zoho"), null);
  assert.deepEqual(auditLines, []);
});

test("exportBookingToERP: rejects unknown providers and unconfirmed bookings", async () => {
  asClient(USERS.nimbusApprover);
  assert.deepEqual(await exportBookingToERP(EXPORT_BOOKING, "netsuite"), { ok: false, error: "Choose an expense system." });
  assert.deepEqual(await exportBookingToERP("bbbbbbbb-0003-4000-8000-000000000003", "zoho"), { ok: false, error: "Only confirmed bookings can be exported." });
});

for (const provider of ["zoho", "erpnext"]) {
  test(`exportBookingToERP(${provider}) without an endpoint: recorded as mocked, audited with the requester`, async () => {
    asClient(USERS.nimbusApprover);
    const before = Date.now();
    assert.equal(receiptState("CONFIRMED", (await findExpenseExport(EXPORT_BOOKING, "booking.confirmed", provider))?.status ?? null).kind, "pending");

    const result = await exportBookingToERP(EXPORT_BOOKING, provider);
    assert.deepEqual(result, { ok: true, data: { bookingId: EXPORT_BOOKING, provider, export: "mocked", companyId: NIMBUS } });

    const row = await findExpenseExport(EXPORT_BOOKING, "booking.confirmed", provider);
    assert.equal(row.status, "mocked");
    assert.equal(row.destination, "mock");
    assert.equal(row.requested_by, USERS.nimbusApprover.userId);
    assert.equal(row.attempts, 1);
    assert.deepEqual([row.response_code, row.error], [null, null]);
    assert.ok(Date.parse(row.created_at) >= before, row.created_at);
    assert.equal(receiptState("CONFIRMED", row.status).kind, "available");

    assert.equal(auditLines.length, 1);
    assert.equal(auditLines[0].booking_id, EXPORT_BOOKING);
    assert.equal(auditLines[0].provider, provider);
    assert.equal(auditLines[0].status, "mocked");
    assert.equal(auditLines[0].destination, "mock");
    assert.ok(Date.parse(auditLines[0].at) >= before, auditLines[0].at);
  });
}

test("exportBookingToERP: a second export to the same provider is skipped, not re-sent", async () => {
  asClient(USERS.nimbusApprover);
  const result = await exportBookingToERP(EXPORT_BOOKING, "zoho");
  assert.deepEqual(result, { ok: true, data: { bookingId: EXPORT_BOOKING, provider: "zoho", export: "skipped", companyId: NIMBUS, message: "Already sent to Zoho Expense." } });
  assert.equal((await findExpenseExport(EXPORT_BOOKING, "booking.confirmed", "zoho")).attempts, 1);
  assert.deepEqual(auditLines.map((l) => [l.status, l.reason]), [["skipped", "already exported"]]);
});

test("exportBookingToERP: an admin's export records the admin as requester", async () => {
  asAdmin();
  const result = await exportBookingToERP(ITC_BOOKING, "erpnext");
  assert.equal(result.ok && result.data.export, "mocked");
  assert.equal((await findExpenseExport(ITC_BOOKING, "booking.confirmed", "erpnext")).requested_by, ADMIN_ID);
});
