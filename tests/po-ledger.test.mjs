import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionError, dispatch, unwrap } from "../lib/mutations/dispatch.ts";
import { createOptimisticState, errorMessage } from "../lib/mutations/optimistic.ts";
import { allocationStatusFor, ineligibility, ledger, poBalance, selectPo, validateNewPo } from "../lib/procurement/po-ledger.ts";
import { parseTelemetryEvent, visibleTo } from "../lib/telemetry/events.ts";
import { isStale } from "../lib/telemetry/refresh.ts";

const T = "nimbus";
const po = (id, over = {}) => ({ id, tenant_id: T, po_number: id.toUpperCase(), department_id: null, amount_inr: 100000, valid_from: "2026-04-01", valid_to: "2027-03-31", status: "open", ...over });
const alloc = (id, poId, amount, status = "committed", over = {}) => ({ id, po_id: poId, booking_id: `b-${id}`, amount_inr: amount, status, over_balance: false, created_at: `2026-10-0${id.length}T00:00:00Z`, ...over });
const booking = (amount, over = {}) => ({ tenantId: T, eventDate: "2026-11-20", departmentId: null, amount, ...over });

test("allocation status follows the booking lifecycle", () => {
  assert.deepEqual(
    ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "SETTLED", "CANCELLED"].map(allocationStatusFor),
    ["committed", "committed", "committed", "consumed", "consumed", "released"]
  );
});

test("balance: committed and consumed draw the PO down; released gives it back", () => {
  const allocations = [alloc("a", "p1", 30000), alloc("bb", "p1", 20000, "consumed"), alloc("ccc", "p1", 50000, "released"), alloc("dddd", "other", 99999)];
  assert.deepEqual(poBalance(po("p1"), allocations), { amount: 100000, committed: 30000, consumed: 20000, remaining: 50000, usedPct: 50, overrun: false });
  // Re-allocating a booking ignores its own current allocation.
  assert.equal(poBalance(po("p1"), allocations, "b-a").remaining, 80000);
  const over = poBalance(po("p1"), [alloc("a", "p1", 120000, "committed", { over_balance: true })]);
  assert.equal(over.remaining, -20000);
  assert.equal(over.overrun, true);
  assert.equal(over.usedPct, 120);
});

test("eligibility: tenant, status, validity window and department", () => {
  assert.equal(ineligibility(po("p"), booking(1)), null);
  assert.match(ineligibility(po("p", { tenant_id: "other" }), booking(1)), /another company/);
  assert.match(ineligibility(po("p", { status: "closed" }), booking(1)), /closed/);
  assert.match(ineligibility(po("p", { valid_to: "2026-10-31" }), booking(1)), /valid 2026-04-01 to 2026-10-31/);
  assert.match(ineligibility(po("p", { department_id: "eng" }), booking(1, { departmentId: "sales" })), /another department/);
  assert.equal(ineligibility(po("p", { department_id: "eng" }), booking(1, { departmentId: "eng" })), null);
});

test("selectPo: companies without POs are unaffected", () => {
  assert.deepEqual(selectPo([po("p", { tenant_id: "someone-else" })], [], booking(5000)), { kind: "none" });
});

test("selectPo: department PO first, then the one expiring soonest, among those with room", () => {
  const pos = [po("wide-late", { valid_to: "2027-03-31" }), po("wide-soon", { valid_to: "2026-12-31" }), po("eng", { department_id: "eng" })];
  assert.equal(selectPo(pos, [], booking(5000, { departmentId: "eng" })).po.id, "eng");
  assert.equal(selectPo(pos, [], booking(5000, { departmentId: "sales" })).po.id, "wide-soon");
  // The department PO is full: fall back to a company-wide one.
  const full = [alloc("a", "eng", 99000)];
  assert.equal(selectPo(pos, full, booking(5000, { departmentId: "eng" })).po.id, "wide-soon");
});

test("selectPo: when nothing has room, the fullest-balance PO is flagged for sign-off", () => {
  const pos = [po("small", { amount_inr: 20000 }), po("big", { amount_inr: 60000 })];
  const sel = selectPo(pos, [alloc("a", "big", 50000)], booking(30000));
  assert.equal(sel.kind, "over_balance");
  assert.equal(sel.po.id, "small"); // 20k left beats big's 10k
  assert.equal(sel.shortfall, 10000);
  assert.equal(sel.reason, "it needs ₹30,000 from PO SMALL, which has ₹20,000 left");
});

test("selectPo: a chosen PO is used if eligible, and refused with the reason if not", () => {
  const pos = [po("a"), po("b", { status: "closed" })];
  assert.equal(selectPo(pos, [], booking(1000, { poId: "a" })).kind, "ok");
  assert.deepEqual(selectPo(pos, [], booking(1000, { poId: "b" })), { kind: "ineligible", reason: "PO B is closed" });
  assert.equal(selectPo(pos, [], booking(1000, { poId: "nope" })).kind, "ineligible");
});

test("selectPo: POs exist but none covers the booking", () => {
  const sel = selectPo([po("eng", { department_id: "eng" }), po("old", { valid_to: "2026-06-30" })], [], booking(1000, { departmentId: "sales" }));
  assert.equal(sel.kind, "ineligible");
  assert.match(sel.reason, /No open purchase order covers this booking \(PO ENG is for another department; PO OLD is valid/);
});

test("ledger: newest first with a running balance; released rows don't draw", () => {
  const rows = ledger(po("p"), [alloc("a", "p", 30000), alloc("bb", "p", 10000, "released"), alloc("ccc", "p", 20000, "consumed")]);
  assert.deepEqual(rows.map((r) => [r.id, r.balanceAfter]), [["ccc", 50000], ["bb", 70000], ["a", 70000]]);
});

test("validateNewPo: normalises and rejects bad input", () => {
  assert.deepEqual(validateNewPo({ po_number: " nim-q4 ", amount_inr: 250000.004, valid_from: "2026-10-01", valid_to: "2026-12-31", description: "  Q4  " }, []), {
    ok: true,
    value: { po_number: "NIM-Q4", amount_inr: 250000, valid_from: "2026-10-01", valid_to: "2026-12-31", department_id: null, description: "Q4" },
  });
  const err = (over, existing = []) => validateNewPo({ po_number: "X1", amount_inr: 1, valid_from: "2026-01-01", valid_to: "2026-12-31", ...over }, existing).error;
  assert.match(err({ po_number: "bad number!" }), /letters, digits/);
  assert.equal(err({}, ["x1"]), "PO X1 already exists.");
  assert.equal(err({ amount_inr: 0 }), "Enter the PO value.");
  assert.equal(err({ valid_to: "2025-12-31" }), "The PO must end on or after it starts.");
});

test("optimistic PO changes: a refused reallocation snaps back without losing a concurrent close", async () => {
  const state = createOptimisticState({ pos: [po("a"), po("b")], allocations: [alloc("x", "a", 40000)] });
  const move = state.mutate({
    apply: (s) => ({ ...s, allocations: s.allocations.map((a) => ({ ...a, po_id: "b" })) }),
    run: async () => unwrap(await dispatch("t", () => { throw new ActionError("PO B has ₹0 left, not enough for ₹40000"); })),
  });
  const close = state.mutate({ apply: (s) => ({ ...s, pos: s.pos.map((p) => (p.id === "a" ? { ...p, status: "closed" } : p)) }), run: async () => "ok" });
  assert.equal(state.view().allocations[0].po_id, "b");
  const [moved] = await Promise.all([move, close]);
  assert.equal(errorMessage(moved.error), "PO B has ₹0 left, not enough for ₹40000");
  assert.equal(state.view().allocations[0].po_id, "a");
  assert.equal(state.view().pos[0].status, "closed");
});

test("po events: parsed, operator-only, refresh the client portal", () => {
  const e = { seq: 4, at: 4, type: "po", poId: "p1", change: "reallocated" };
  assert.deepEqual(parseTelemetryEvent(JSON.stringify(e)), e);
  assert.equal(parseTelemetryEvent(JSON.stringify({ ...e, change: "deleted" })), null);
  assert.equal(visibleTo(e, { ops: false, venues: true }), false);
  assert.equal(isStale("/client", [e]), true);
  assert.equal(isStale("/venues", [e]), false);
});
