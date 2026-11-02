// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Control Tower (lib/control-tower/summary.ts): filters, compliance and spend
// figures, breakdowns, approval turnaround and the CSV export; and who may
// open /control-tower (lib/auth/roles.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { filterBookings, statusGroupOf, summarise, towerCsv, violationLabel } from "../lib/control-tower/summary.ts";
import { canAccessWorkspace } from "../lib/auth/roles.ts";

let n = 0;
const booking = (over = {}) => ({
  id: `b${++n}`,
  company_id: "c1",
  company_name: "Nimbus Analytics Private Limited",
  venue_name: "The Copper Courtyard",
  city: "Bengaluru",
  event_date: "2026-10-10",
  created_at: "2026-10-01T10:00:00Z",
  status: "CONFIRMED",
  event_type: "team_meal",
  department_id: "eng",
  cost_center: null,
  requested_by: "u1",
  party_size: 10,
  total_amount_inr: 20000,
  invoice_total_inr: 23600,
  list_budget_per_head_inr: null,
  policy_status: "in_policy",
  policy_violation_reasons: [],
  ...over,
});

test("filters combine; 'none' matches unassigned department and event type", () => {
  const rows = [
    booking({ id: "a" }),
    booking({ id: "b", department_id: null, event_type: null }),
    booking({ id: "c", city: "Delhi", status: "PENDING_APPROVAL" }),
    booking({ id: "d", company_id: "c2", event_date: "2026-12-01" }),
  ];
  const ids = (f) => filterBookings(rows, f).map((b) => b.id);
  assert.deepEqual(ids({}), ["a", "b", "c", "d"]);
  assert.deepEqual(ids({ departmentId: "none" }), ["b"]);
  assert.deepEqual(ids({ eventType: "none" }), ["b"]);
  assert.deepEqual(ids({ city: "Delhi" }), ["c"]);
  assert.deepEqual(ids({ status: "awaiting_signoff" }), ["c"]);
  assert.deepEqual(ids({ companyId: "c1", to: "2026-11-30" }), ["a", "b", "c"]);
  assert.deepEqual(ids({ from: "2026-11-01" }), ["d"]);
});

test("status groups cover every booking status", () => {
  for (const s of ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "SETTLED", "CANCELLED"]) assert.notEqual(statusGroupOf(s), null, s);
  assert.equal(statusGroupOf("SETTLED"), "completed");
});

test("committed spend leaves out cancellations; savings come from list price", () => {
  const s = summarise(
    [
      booking({ invoice_total_inr: 11800 }),
      booking({ status: "CANCELLED", invoice_total_inr: 50000 }),
      booking({ status: "PENDING_APPROVAL", invoice_total_inr: 1000, party_size: 10, list_budget_per_head_inr: 2500, total_amount_inr: 20000 }),
      // Above list: no negative savings.
      booking({ list_budget_per_head_inr: 1000, party_size: 10, total_amount_inr: 12000, invoice_total_inr: 0 }),
    ],
    []
  );
  assert.equal(s.requests, 4);
  assert.equal(s.committedInr, 12800);
  assert.equal(s.savingsInr, 5000);
  assert.equal(s.awaitingSignoff, 1);
});

test("compliance counts only requests with a policy outcome", () => {
  const s = summarise(
    [
      booking(),
      booking(),
      booking({ policy_status: "requires_manager", policy_violation_reasons: ["PER_HEAD_MANAGER_TIER", "ALCOHOL_NEEDS_APPROVAL"] }),
      booking({ policy_status: "out_of_policy", policy_violation_reasons: ["EXCEEDS_PER_HEAD_CAP", "PER_HEAD_MANAGER_TIER"] }),
      booking({ policy_status: null }),
    ],
    []
  );
  assert.equal(s.complianceRate, 0.5);
  assert.equal(s.policyAssessed, 4);
  assert.deepEqual(s.policyCounts, { in_policy: 2, requires_manager: 1, requires_cfo: 0, out_of_policy: 1 });
  assert.deepEqual(s.topViolations[0], { code: "PER_HEAD_MANAGER_TIER", label: "Per head needs a manager", count: 2 });
  assert.equal(summarise([booking({ policy_status: null })], []).complianceRate, null);
});

test("breakdowns group by department and event type, biggest spend first", () => {
  const s = summarise(
    [
      booking({ department_id: "eng", invoice_total_inr: 100 }),
      booking({ department_id: "sales", invoice_total_inr: 500, policy_status: "requires_cfo" }),
      booking({ department_id: null, invoice_total_inr: 50, event_type: null }),
    ],
    []
  );
  assert.deepEqual(s.byDepartment.map((d) => [d.key, d.committedInr, d.complianceRate]), [["sales", 500, 0], ["eng", 100, 1], ["none", 50, 1]]);
  assert.deepEqual(s.byEventType.map((d) => d.key), ["team_meal", "none"]);
});

test("sign-off time: median from when the approver's turn began, decided ones only, these bookings only", () => {
  const rows = [booking({ id: "x" }), booking({ id: "y" })];
  const s = summarise(rows, [
    { booking_id: "x", status: "APPROVED", created_at: "2026-10-01T00:00:00Z", decided_at: "2026-10-01T02:00:00Z" },
    // Tier 2: activated a day after creation, decided 4 h later.
    { booking_id: "y", status: "REJECTED", created_at: "2026-10-01T00:00:00Z", activated_at: "2026-10-02T00:00:00Z", decided_at: "2026-10-02T04:00:00Z" },
    { booking_id: "y", status: "PENDING", created_at: "2026-10-01T00:00:00Z", decided_at: null },
    { booking_id: "other", status: "APPROVED", created_at: "2026-10-01T00:00:00Z", decided_at: "2026-10-09T00:00:00Z" },
  ]);
  assert.equal(s.medianApprovalHours, 3);
  assert.equal(summarise(rows, []).medianApprovalHours, null);
});

test("CSV: header, quoting, and spreadsheet formulas defused", () => {
  const csv = towerCsv([
    { ...booking({ id: "b-1", venue_name: 'The "Vault", UB City', cost_center: "=HYPERLINK(\"x\")", policy_violation_reasons: ["OPEN_BAR_WEEKDAY"] }), department_name: "Engineering", requester_name: "Asha", payment_status: "captured" },
  ]);
  const [header, row] = csv.trimEnd().split("\r\n");
  assert.match(header, /^Booking ID,Company,Event date/);
  assert.match(row, /"The ""Vault"", UB City"/);
  assert.match(row, /"'=HYPERLINK\(""x""\)"/);
  assert.match(row, /,Weekday open bar,captured$/);
  assert.equal(violationLabel("SOMETHING_NEW"), "something new");
});

test("every client role and admins open the Control Tower; venues and partners don't", () => {
  for (const r of ["ORGANIZER", "APPROVER", "FINANCE_VIEWER"]) assert.equal(canAccessWorkspace("CLIENT", r, "/control-tower"), true, r);
  assert.equal(canAccessWorkspace("ADMIN", null, "/control-tower"), true);
  assert.equal(canAccessWorkspace("PROPERTY", null, "/control-tower"), false);
  assert.equal(canAccessWorkspace("PARTNER", null, "/control-tower"), false);
});
