import { before, test } from "node:test";
import assert from "node:assert/strict";

import { canAccessWorkspace } from "../lib/auth/roles.ts";
import { canManageGovernance, canViewGovernance, governedCompany } from "../lib/services/enterprise/access.ts";
import {
  approvalDemand,
  bandLabel,
  chainProgress,
  escalationTarget,
  isActionable,
  isOverdue,
  levelsNeeded,
  matchRule,
  overlappingRule,
  parseRuleInput,
  planSteps,
  requestOutcome,
  stepsToActivate,
} from "../lib/services/enterprise/approvalEngine.ts";
import { budgetBalance, budgetsCovering, checkSpend, holdStatusFor, parseBudgetInput, periodFor, periodLabel } from "../lib/services/enterprise/budgetService.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

const T = "nimbus";
const ENG = "eng";
const rule = (id, min, max, levels, over = {}) => ({ id, tenant_id: T, department_id: null, name: id, min_amount_inr: min, max_amount_inr: max, approval_levels: levels, sla_hours: 48, is_active: true, ...over });
const chain = [
  { approver_user_id: "manager", tier_level: 1 },
  { approver_user_id: "director", tier_level: 2 },
  { approver_user_id: "cfo", tier_level: 3 },
];
const approval = (id, approver, step, over = {}) => ({ id, approver_id: approver, requested_by: "organizer", status: "PENDING", step, activated_at: step === 1 ? "2026-10-01T00:00:00Z" : null, due_at: null, escalated_from: null, ...over });

// =============================================================================================
// Approval rules: triggering and threshold bypass
// =============================================================================================

test("rule bands are (min, max]: at or below the lowest band bypasses rule-based sign-off", () => {
  const rules = [rule("small", 50000, 200000, 1), rule("large", 200000, null, 2)];
  const at = (amount) => matchRule(rules, { tenantId: T, departmentId: null, amount })?.id ?? null;
  assert.equal(at(50000), null, "exactly the threshold bypasses");
  assert.equal(at(49999.99), null);
  assert.equal(at(50000.01), "small");
  assert.equal(at(200000), "small", "the upper bound is inclusive");
  assert.equal(at(200000.01), "large");
  assert.equal(at(9e9), "large", "an open band has no upper bound");
});

test("a team's own band wins over the company-wide one; paused rules and other companies never match", () => {
  const rules = [rule("all", 0, null, 1), rule("eng", 0, null, 3, { department_id: ENG }), rule("paused", 0, null, 5, { department_id: "sales", is_active: false }), rule("other", 0, null, 9, { tenant_id: "vertex" })];
  assert.equal(matchRule(rules, { tenantId: T, departmentId: ENG, amount: 10 }).id, "eng");
  assert.equal(matchRule(rules, { tenantId: T, departmentId: "sales", amount: 10 }).id, "all");
  assert.equal(matchRule(rules, { tenantId: T, departmentId: null, amount: 10 }).id, "all");
  assert.equal(matchRule([rules[3]], { tenantId: T, departmentId: null, amount: 10 }), null);
});

test("approvalDemand: nothing asks for sign-off → bypass; otherwise the strictest sets the levels", () => {
  const noPolicy = { requiresApproval: false };
  assert.deepEqual(approvalDemand({ policy: noPolicy, amount: 40000, rule: null }), { required: false });

  const band = rule("large", 200000, null, 3);
  const byRule = approvalDemand({ policy: noPolicy, amount: 250000, rule: band });
  assert.equal(byRule.required, true);
  assert.equal(byRule.levels, 3);
  assert.equal(byRule.ruleId, "large");
  assert.equal(byRule.slaHours, 48);
  assert.match(byRule.reasons[0], /falls in the “large” band \(above ₹2,00,000\), which needs 3 levels/);

  // Policy asks for two tiers (high-value), the band for one: two.
  assert.equal(approvalDemand({ policy: { requiresApproval: true, reason: "high value", tiers: 2 }, amount: 1, rule: rule("s", 0, null, 1) }).levels, 2);
  // A budget or PO breach alone needs one level, and its reason is kept.
  const byBudget = approvalDemand({ policy: noPolicy, amount: 1, rule: null, budgetReason: "over the team budget" });
  assert.deepEqual([byBudget.levels, byBudget.reasons, byBudget.ruleId], [1, ["over the team budget"], null]);
  assert.equal(approvalDemand({ policy: noPolicy, amount: 1, rule: null, extraReasons: ["PO short"] }).levels, 1);
});

test("planSteps: the first N tiers in order, step 1 active, the requester skipped", () => {
  const plan = planSteps(chain, { requesterId: "organizer", levels: 2 });
  assert.deepEqual(plan.steps.map((s) => [s.approver_id, s.step, s.active]), [["manager", 1, true], ["director", 2, false]]);
  // The manager requests: the director and CFO step up.
  assert.deepEqual(planSteps(chain, { requesterId: "manager", levels: 2 }).steps.map((s) => s.approver_id), ["director", "cfo"]);
  // Not enough approvers besides the requester.
  assert.deepEqual(planSteps(chain, { requesterId: "manager", levels: 3 }), { ok: false, available: 2 });
  assert.equal(levelsNeeded([rule("a", 0, 10, 2), rule("b", 10, null, 4, { is_active: false })]), 2);
});

// =============================================================================================
// Sequential chains, mirrored for the local stores and the UI
// =============================================================================================

test("stepsToActivate: the next step only once nothing active is open", () => {
  const rows = [approval("a1", "manager", 1), approval("a2", "director", 2), approval("a3", "cfo", 3)];
  assert.deepEqual(stepsToActivate(rows, "a1"), ["a2"]);
  // Another active approval on the same step is still open: wait for it.
  assert.deepEqual(stepsToActivate([...rows, approval("a1b", "x", 1)], "a1"), []);
  assert.equal(isActionable(rows[0]), true);
  assert.equal(isActionable(rows[1]), false);
});

test("requestOutcome and chainProgress treat escalated rows as handed on", () => {
  const rows = [
    approval("a1", "manager", 1, { status: "ESCALATED" }),
    approval("a1x", "cfo", 1, { status: "APPROVED", escalated_from: "a1" }),
    approval("a2", "director", 2, { activated_at: "2026-10-02T00:00:00Z", due_at: "2026-10-03T00:00:00Z" }),
  ];
  assert.equal(requestOutcome(rows), "pending");
  const steps = chainProgress(rows);
  assert.deepEqual(steps.map((s) => [s.step, s.approval.id, s.state, s.escalatedFrom.map((e) => e.id)]), [
    [1, "a1x", "approved", ["a1"]],
    [2, "a2", "waiting", []],
  ]);
  assert.equal(isOverdue(rows[2], new Date("2026-10-04T00:00:00Z")), true);
  assert.equal(isOverdue(rows[2], new Date("2026-10-02T12:00:00Z")), false);
  assert.equal(requestOutcome([...rows.slice(0, 2), { ...rows[2], status: "APPROVED" }]), "approved");
  assert.equal(requestOutcome([{ status: "APPROVED" }, { status: "REJECTED" }]), "rejected");
});

test("escalationTarget: the next tier up that isn't the requester or already on the request", () => {
  const rows = [approval("a1", "manager", 1), approval("a2", "director", 2)];
  assert.equal(escalationTarget(chain, rows, "a1"), "cfo", "the director is already step 2");
  assert.equal(escalationTarget(chain, [approval("a1", "manager", 1)], "a1"), "director");
  assert.equal(escalationTarget(chain, [approval("a1", "cfo", 1)], "a1"), null, "nobody above the top tier");
  assert.equal(escalationTarget(chain, [approval("a1", "manager", 1, { requested_by: "director" })], "a1"), "cfo");
});

test("rule form: amounts with ₹ and commas, blank maximum = open band, and overlaps in one scope", () => {
  const ok = parseRuleInput({ name: " Large events ", minAmount: "₹2,00,000", maxAmount: "", levels: "2", slaHours: "" });
  assert.deepEqual(ok, { ok: true, value: { name: "Large events", department_id: null, min_amount_inr: 200000, max_amount_inr: null, approval_levels: 2, sla_hours: 48 } });
  assert.match(parseRuleInput({ name: "", levels: 1 }).error, /name/);
  assert.match(parseRuleInput({ name: "x", minAmount: "500", maxAmount: "100", levels: 1 }).error, /above ₹500/);
  assert.match(parseRuleInput({ name: "x", levels: 11 }).error, /1 to 10/);
  assert.match(parseRuleInput({ name: "x", levels: 1, slaHours: 0 }).error, /1 to 720/);

  const rules = [rule("mid", 100000, 500000, 1), rule("eng", 0, null, 2, { department_id: ENG })];
  const cand = (min, max, dept = null, id) => ({ ...parseRuleInput({ name: "c", minAmount: min, maxAmount: max, levels: 1 }).value, department_id: dept, tenant_id: T, id });
  assert.equal(overlappingRule(rules, cand(400000, 900000))?.id, "mid");
  assert.equal(overlappingRule(rules, cand(500000, null)), null, "bands touching at 5L don't overlap: (1L, 5L] and (5L, ∞)");
  assert.equal(overlappingRule(rules, cand(0, 100000)), null);
  assert.equal(overlappingRule(rules, cand(0, null, "sales")), null, "another team's scope");
  assert.equal(overlappingRule(rules, cand(0, null, null, "mid")), null, "editing a rule ignores itself");
  assert.equal(bandLabel(rule("x", 0, 50000, 1)), "up to ₹50,000");
});

// =============================================================================================
// Budgets: periods, balances and cap enforcement
// =============================================================================================

test("periods: calendar months and Indian FY quarters", () => {
  assert.deepEqual(periodFor("monthly", "2028-02-14"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(periodFor("quarterly", "2026-11-20"), { start: "2026-10-01", end: "2026-12-31" });
  assert.deepEqual(periodFor("quarterly", "2027-03-31"), { start: "2027-01-01", end: "2027-03-31" });
  assert.deepEqual(periodFor("quarterly", "2026-04-01"), { start: "2026-04-01", end: "2026-06-30" });
  assert.equal(periodLabel("quarterly", "2026-10-01"), "Q3 FY26-27 (Oct–Dec 2026)");
  assert.equal(periodLabel("quarterly", "2027-01-01"), "Q4 FY26-27 (Jan–Mar 2027)");
  assert.equal(periodLabel("monthly", "2026-10-01"), "Oct 2026");
});

test("holds follow the booking or order lifecycle", () => {
  assert.deepEqual(
    ["PENDING_APPROVAL", "PENDING", "CONFIRMED", "PLACED", "COMPLETED", "SETTLED", "DELIVERED", "CANCELLED"].map(holdStatusFor),
    ["held", "committed", "committed", "committed", "consumed", "consumed", "consumed", "released"]
  );
});

const budget = (id, over = {}) => ({ id, tenant_id: T, department_id: ENG, period: "quarterly", period_start: "2026-10-01", period_end: "2026-12-31", limit_inr: 100000, enforcement: "approval", ...over });
const hold = (id, budgetId, amount, status = "committed") => ({ id, budget_id: budgetId, booking_id: `b-${id}`, amount_inr: amount, status, over_budget: false });
const spend = (amount, over = {}) => ({ tenantId: T, departmentId: ENG, date: "2026-11-15", amount, ...over });

test("balance: held, committed and consumed draw the budget down; released gives it back", () => {
  const holds = [hold("a", "q", 20000, "held"), hold("b", "q", 30000), hold("c", "q", 10000, "consumed"), hold("d", "q", 99999, "released"), hold("e", "other", 5)];
  assert.deepEqual(budgetBalance(budget("q"), holds), { limit: 100000, held: 20000, committed: 30000, consumed: 10000, remaining: 40000, usedPct: 60, overrun: false });
  assert.equal(budgetBalance(budget("q"), holds, "b-a").remaining, 60000, "re-checking a request ignores its own hold");
});

test("checkSpend: no department or no budget for the period → nothing to hold", () => {
  assert.deepEqual(checkSpend([budget("q")], [], spend(1000, { departmentId: null })), { kind: "none" });
  assert.deepEqual(checkSpend([budget("q")], [], spend(1000, { date: "2027-01-05" })), { kind: "none" });
  assert.deepEqual(checkSpend([budget("q", { tenant_id: "vertex" })], [], spend(1000)), { kind: "none" });
});

test("checkSpend: within the cap holds against every covering budget", () => {
  const month = budget("m", { period: "monthly", period_start: "2026-11-01", period_end: "2026-11-30", limit_inr: 50000 });
  const r = checkSpend([budget("q"), month], [], spend(50000));
  assert.deepEqual(r, { kind: "ok", holds: [{ budget_id: "m", over_budget: false }, { budget_id: "q", over_budget: false }] });
  assert.deepEqual(budgetsCovering([budget("q"), month], spend(1, { date: "2026-12-01" })).map((b) => b.id), ["q"]);
});

test("checkSpend: past an 'approval' budget needs sign-off; past a hard cap is refused", () => {
  const drawn = [hold("a", "q", 80000)];
  const over = checkSpend([budget("q")], drawn, spend(30000));
  assert.equal(over.kind, "over");
  assert.deepEqual(over.holds, [{ budget_id: "q", over_budget: true }]);
  assert.equal(over.shortfall, 10000);
  assert.match(over.reason, /needs ₹30,000 and the team's quarterly budget for Q3 FY26-27 \(Oct–Dec 2026\) has ₹20,000 left/);

  const capped = checkSpend([budget("q", { enforcement: "block" })], drawn, spend(30000));
  assert.equal(capped.kind, "blocked");
  assert.match(capped.reason, /hard cap/);
  // Exactly the remaining balance still fits.
  assert.equal(checkSpend([budget("q", { enforcement: "block" })], drawn, spend(20000)).kind, "ok");
  // One hard cap among several budgets refuses the whole request.
  const month = budget("m", { period: "monthly", period_start: "2026-11-01", period_end: "2026-11-30", limit_inr: 10000, enforcement: "block" });
  assert.equal(checkSpend([budget("q"), month], [], spend(15000)).kind, "blocked");
});

test("budget form: a quarterly budget starts on its FY quarter; bad input is explained", () => {
  assert.deepEqual(parseBudgetInput({ departmentId: ENG, period: "quarterly", month: "2026-11", limit: "₹5,00,000", enforcement: "block" }), {
    ok: true,
    value: { department_id: ENG, period: "quarterly", period_start: "2026-10-01", limit_inr: 500000, enforcement: "block" },
  });
  assert.equal(parseBudgetInput({ departmentId: ENG, period: "monthly", month: "2026-11", limit: 1 }).value.enforcement, "approval");
  assert.match(parseBudgetInput({ departmentId: "", period: "monthly", month: "2026-11", limit: 1 }).error, /team/);
  assert.match(parseBudgetInput({ departmentId: ENG, period: "weekly", month: "2026-11", limit: 1 }).error, /monthly or quarterly/);
  assert.match(parseBudgetInput({ departmentId: ENG, period: "monthly", month: "2026-13", limit: 1 }).error, /month/);
  assert.match(parseBudgetInput({ departmentId: ENG, period: "monthly", month: "2026-11", limit: "0" }).error, /above ₹0/);
});

// =============================================================================================
// Access
// =============================================================================================

test("every client role sees governance; only Approvers and admins change it; clients act on their own company", () => {
  for (const c of ["ORGANIZER", "APPROVER", "FINANCE_VIEWER"]) assert.equal(canAccessWorkspace("CLIENT", c, "/governance"), true, c);
  assert.equal(canAccessWorkspace("PROPERTY", null, "/governance"), false);
  assert.equal(canAccessWorkspace("PARTNER", null, "/governance"), false);

  const client = (corporateRole) => ({ role: "CLIENT", companyId: "c1", corporateRole });
  assert.equal(canManageGovernance(client("APPROVER")), true);
  assert.equal(canManageGovernance(client("ORGANIZER")), false);
  assert.equal(canManageGovernance(client("FINANCE_VIEWER")), false);
  assert.equal(canManageGovernance({ role: "ADMIN", companyId: null, corporateRole: null }), true);
  assert.equal(canViewGovernance({ role: "PROPERTY", companyId: null, corporateRole: null }), false);
  assert.equal(governedCompany(client("APPROVER"), "someone-else"), "c1");
  assert.equal(governedCompany({ role: "ADMIN", companyId: null, corporateRole: null }, "c2"), "c2");
  assert.equal(governedCompany({ role: "ADMIN", companyId: null, corporateRole: null }, null), null);
});

// =============================================================================================
// Postgres (PGlite with every migration): triggers, functions and RLS
// =============================================================================================

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const VENUE = "aaaaaaaa-0001-4000-8000-000000000001";
const ENGINEERING = "dddddddd-0001-4000-8000-000000000001";
const SALES = "dddddddd-0002-4000-8000-000000000002";
const U = {
  organizer: "e0000000-0000-4000-8000-000000000001",
  manager: "e0000000-0000-4000-8000-000000000002",
  director: "e0000000-0000-4000-8000-000000000003",
  cfo: "e0000000-0000-4000-8000-000000000004",
  vertexUser: "e0000000-0000-4000-8000-000000000005",
};

let db;

before(async () => {
  db = await createDatabase();
  for (const [name, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name}@example.test`]);
  await db.query(
    `insert into platform_users (user_id, role, company_id, corporate_role) values
       ($1, 'CLIENT', $6, 'ORGANIZER'), ($2, 'CLIENT', $6, 'APPROVER'), ($3, 'CLIENT', $6, 'APPROVER'),
       ($4, 'CLIENT', $6, 'APPROVER'), ($5, 'CLIENT', $7, 'ORGANIZER')`,
    [U.organizer, U.manager, U.director, U.cfo, U.vertexUser, NIMBUS, VERTEX]
  );
  await db.query(`select replace_approval_chain($1, $2)`, [NIMBUS, [U.manager, U.director, U.cfo]]);
});

/** Runs fn as the database owner (the service role's view), rolled back afterwards. */
const scratch = (fn) =>
  db.transaction(async (tx) => {
    const result = await fn(tx);
    await tx.rollback();
    return result;
  });

const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];

async function newBooking(tx, { status = "PENDING_APPROVAL", total = 100000, date = "2026-11-20", department = ENGINEERING } = {}) {
  return (
    await one(
      tx,
      `insert into bookings (company_id, venue_id, party_size, budget_per_head_inr, total_amount_inr, status, event_date, department_id)
       values ($1, $2, 40, $3, $4, $5, $6, $7) returning id`,
      [NIMBUS, VENUE, total / 40, total, status, date, department]
    )
  ).id;
}

async function newRule(tx, { min = 0, max = null, levels = 1, sla = 24, department = null, active = true } = {}) {
  return (
    await one(
      tx,
      `insert into approval_policy_rules (tenant_id, department_id, name, min_amount_inr, max_amount_inr, approval_levels, sla_hours, is_active)
       values ($1, $2, 'rule', $3, $4, $5, $6, $7) returning id`,
      [NIMBUS, department, min, max, levels, sla, active]
    )
  ).id;
}

/** Raises the sequential approvals the app would: step 1 active, the rest queued. */
async function raise(tx, bookingId, approvers, ruleId = null) {
  const ids = [];
  for (const [i, approver] of approvers.entries()) {
    const row = await one(
      tx,
      `insert into booking_approvals (tenant_id, booking_id, requested_by, approver_id, reason, step, rule_id, activated_at)
       values ($1, $2, $3, $4, 'over threshold', $5::smallint, $6, case when $5::smallint = 1 then now() else null end) returning id`,
      [NIMBUS, bookingId, U.organizer, approver, i + 1, ruleId]
    );
    ids.push(row.id);
  }
  return ids;
}

const approvalsOf = async (tx, bookingId) =>
  (await tx.query(`select id, approver_id, status, step, activated_at, due_at, escalated_from from booking_approvals where booking_id = $1 order by step, created_at`, [bookingId])).rows;
const bookingStatus = async (tx, id) => (await one(tx, `select status from bookings where id = $1`, [id])).status;

test("db: sequential chain — only the active step can be decided; each approval activates the next; the last releases the booking", async () => {
  await scratch(async (tx) => {
    const ruleId = await newRule(tx, { levels: 3, sla: 24 });
    const booking = await newBooking(tx);
    const [s1, s2, s3] = await raise(tx, booking, [U.manager, U.director, U.cfo], ruleId);

    let rows = await approvalsOf(tx, booking);
    assert.ok(rows[0].due_at, "the active step gets the rule's deadline");
    assert.equal(rows[0].due_at - rows[0].activated_at, 24 * 3600 * 1000);
    assert.deepEqual(rows.slice(1).map((r) => [r.activated_at, r.due_at]), [[null, null], [null, null]]);

    await tx.query("savepoint s");
    await assert.rejects(tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [s2]), /waiting for an earlier step/);
    await tx.query("rollback to savepoint s");

    await tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [s1]);
    rows = await approvalsOf(tx, booking);
    assert.ok(rows[1].activated_at && rows[1].due_at, "step 2 activates with its own deadline");
    assert.equal(rows[2].activated_at, null);
    assert.equal(await bookingStatus(tx, booking), "PENDING_APPROVAL");

    await tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [s2]);
    await tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [s3]);
    assert.equal(await bookingStatus(tx, booking), "PENDING", "released to the venue");
  });
});

test("db: a rejection at any step cancels the booking; queued steps are never activated", async () => {
  await scratch(async (tx) => {
    const booking = await newBooking(tx);
    const [s1] = await raise(tx, booking, [U.manager, U.director]);
    await tx.query(`update booking_approvals set status = 'REJECTED' where id = $1`, [s1]);
    assert.equal(await bookingStatus(tx, booking), "CANCELLED");
    assert.equal((await approvalsOf(tx, booking))[1].activated_at, null);
  });
});

test("db: approvals raised the old way (no step data) still work in parallel", async () => {
  await scratch(async (tx) => {
    const booking = await newBooking(tx);
    for (const a of [U.manager, U.director]) {
      await tx.query(`insert into booking_approvals (tenant_id, booking_id, requested_by, approver_id) values ($1, $2, $3, $4)`, [NIMBUS, booking, U.organizer, a]);
    }
    const rows = await approvalsOf(tx, booking);
    assert.ok(rows.every((r) => r.step === 1 && r.activated_at && r.due_at === null), "active, no deadline");
    for (const r of rows) await tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [r.id]);
    assert.equal(await bookingStatus(tx, booking), "PENDING");
  });
});

test("db: as the approver (RLS + guard), approving their step activates the next; queued steps and ESCALATED are refused", async () => {
  // Owner-made setup is committed for this test and cleaned up after.
  const booking = await newBooking(db);
  const [s1, s2] = await raise(db, booking, [U.manager, U.director]);
  try {
    const as = (user, fn) => asUser(db, { claims: { sub: user } }, fn);
    await assert.rejects(as(U.director, (tx) => tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [s2])), /waiting for an earlier step/);
    await assert.rejects(as(U.manager, (tx) => tx.query(`update booking_approvals set status = 'ESCALATED' where id = $1`, [s1])), /only be escalated by the platform/);
    await assert.rejects(as(U.manager, (tx) => tx.query(`update booking_approvals set due_at = now() + interval '30 days' where id = $1`, [s1])), /Only the status and decision note/);

    const after = await as(U.manager, async (tx) => {
      const r = await tx.query(`update booking_approvals set status = 'APPROVED', decision_note = 'ok' where id = $1 returning id`, [s1]);
      assert.equal(r.rows.length, 1, "the manager decides their own active step");
      return (await tx.query(`select activated_at from booking_approvals where id = $1`, [s2])).rows[0];
    });
    assert.ok(after.activated_at, "the trigger activated step 2 on the approver's behalf");
  } finally {
    await db.query(`delete from bookings where id = $1`, [booking]);
  }
});

test("db: escalation hands a waiting step to the next tier up; the replacement decides it", async () => {
  await scratch(async (tx) => {
    const ruleId = await newRule(tx, { levels: 1, sla: 12 });
    const booking = await newBooking(tx);
    const [s1] = await raise(tx, booking, [U.manager], ruleId);
    const replacement = (await one(tx, `select escalate_booking_approval($1, 'manager on leave') id`, [s1])).id;

    const rows = await approvalsOf(tx, booking);
    const old = rows.find((r) => r.id === s1);
    const next = rows.find((r) => r.id === replacement);
    assert.equal(old.status, "ESCALATED");
    assert.deepEqual([next.approver_id, next.step, next.status, next.escalated_from], [U.director, 1, "PENDING", s1]);
    assert.ok(next.activated_at && next.due_at, "the replacement is active with a fresh deadline");
    assert.equal((await one(tx, `select decision_note from booking_approvals where id = $1`, [s1])).decision_note, "manager on leave");

    await tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [replacement]);
    assert.equal(await bookingStatus(tx, booking), "PENDING", "the escalated row holds nothing up");
  });
});

test("db: escalation skips approvers already on the request, and refuses when there's nobody higher", async () => {
  await scratch(async (tx) => {
    const booking = await newBooking(tx);
    const [s1, s2] = await raise(tx, booking, [U.manager, U.director]);
    const to = (await one(tx, `select escalate_booking_approval($1) id`, [s1])).id;
    assert.equal((await one(tx, `select approver_id from booking_approvals where id = $1`, [to])).approver_id, U.cfo, "the director is already step 2");

    await tx.query("savepoint s");
    await assert.rejects(tx.query(`select escalate_booking_approval($1)`, [s2]), /queued/, "a queued step can't be escalated");
    await tx.query("rollback to savepoint s");
    await assert.rejects(tx.query(`select escalate_booking_approval($1)`, [to]), /no higher approver/);
  });
});

test("db: the overdue sweep escalates past-deadline steps only; portal users can't run escalations", async () => {
  await scratch(async (tx) => {
    const ruleId = await newRule(tx, { levels: 1, sla: 1 });
    const late = await newBooking(tx);
    const onTime = await newBooking(tx);
    const [lateStep] = await raise(tx, late, [U.manager], ruleId);
    await raise(tx, onTime, [U.manager], ruleId);
    await tx.query(`update booking_approvals set due_at = now() - interval '1 hour' where id = $1`, [lateStep]);

    assert.equal((await one(tx, `select escalate_overdue_approvals() n`)).n, 1);
    assert.equal((await one(tx, `select status from booking_approvals where id = $1`, [lateStep])).status, "ESCALATED");
    assert.ok((await approvalsOf(tx, onTime)).every((r) => r.status === "PENDING"));
  });
  for (const fn of [`escalate_overdue_approvals()`, `escalate_booking_approval(gen_random_uuid())`, `replace_approval_chain('${NIMBUS}', '{}')`]) {
    await assert.rejects(asUser(db, { claims: { sub: U.manager } }, (tx) => tx.query(`select ${fn}`)), /permission denied/, fn);
  }
});

test("db: overlapping active rules in one scope are refused; other teams, touching bands and paused rules are fine", async () => {
  await scratch(async (tx) => {
    await newRule(tx, { min: 100000, max: 500000 });
    await newRule(tx, { min: 500000, max: null }); // (1L, 5L] and (5L, ∞) only touch
    await newRule(tx, { min: 0, max: null, department: ENGINEERING });
    await newRule(tx, { min: 200000, max: 300000, active: false });
    await assert.rejects(newRule(tx, { min: 400000, max: 600000 }), /approval_policy_rules_no_overlap/);
  });
  await scratch(async (tx) => {
    await assert.rejects(newRule(tx, { min: 0, max: null, department: "dddddddd-0004-4000-8000-000000000004" }), /approval_policy_rules_department_fkey/, "another company's department");
  });
});

async function newBudget(tx, { limit = 100000, enforcement = "approval", period = "quarterly", start = "2026-10-01", department = ENGINEERING } = {}) {
  return (
    await one(
      tx,
      `insert into team_budgets (tenant_id, department_id, period, period_start, limit_inr, enforcement) values ($1, $2, $3, $4, $5, $6) returning id, period_end`,
      [NIMBUS, department, period, start, limit, enforcement]
    )
  );
}

const holdFor = (tx, budgetId, bookingId, amount, overBudget = false) =>
  tx.query(`insert into budget_holds (budget_id, tenant_id, booking_id, amount_inr, over_budget) values ($1, $2, $3, $4, $5) returning status`, [budgetId, NIMBUS, bookingId, amount, overBudget]);

test("db: budget periods end on the right day and must be aligned", async () => {
  await scratch(async (tx) => {
    const q = await newBudget(tx);
    assert.equal(q.period_end.toISOString().slice(0, 10), "2026-12-31");
    const m = await newBudget(tx, { period: "monthly", start: "2028-02-01" });
    assert.equal(m.period_end.toISOString().slice(0, 10), "2028-02-29");
    await tx.query("savepoint s");
    await assert.rejects(newBudget(tx, { start: "2026-11-01" }), /team_budgets_period_aligned/, "quarters start in Jan, Apr, Jul or Oct");
    await tx.query("rollback to savepoint s");
    await assert.rejects(newBudget(tx, { period: "monthly", start: "2026-11-15" }), /team_budgets_period_aligned/);
  });
});

test("db: budget cap — holds within the balance pass; past it needs over_budget; a hard cap refuses even that", async () => {
  await scratch(async (tx) => {
    const { id: budget } = await newBudget(tx, { limit: 100000 });
    const first = await newBooking(tx, { total: 60000 });
    assert.equal((await holdFor(tx, budget, first, 60000)).rows[0].status, "held", "awaiting approval: held");

    const second = await newBooking(tx, { total: 50000 });
    await tx.query("savepoint s");
    await assert.rejects(holdFor(tx, budget, second, 50000), (err) => /has 40000.00 left/.test(err.message) && err.code === "23514");
    await tx.query("rollback to savepoint s");
    await holdFor(tx, budget, second, 50000, true); // routed for sign-off

    const { id: capped } = await newBudget(tx, { limit: 10000, enforcement: "block", department: SALES });
    const sales = await newBooking(tx, { total: 20000, department: SALES });
    await assert.rejects(holdFor(tx, capped, sales, 20000, true), /hard cap/);
  });
});

test("db: holds follow their booking — approved commits, cancelled releases the balance", async () => {
  await scratch(async (tx) => {
    const { id: budget } = await newBudget(tx, { limit: 100000 });
    const booking = await newBooking(tx, { total: 80000 });
    await holdFor(tx, budget, booking, 80000);
    const [s1] = await raise(tx, booking, [U.manager]);
    await tx.query(`update booking_approvals set status = 'APPROVED' where id = $1`, [s1]);
    const status = async () => (await one(tx, `select status from budget_holds where booking_id = $1`, [booking])).status;
    assert.equal(await status(), "committed");

    await tx.query(`update bookings set status = 'CANCELLED' where id = $1`, [booking]);
    assert.equal(await status(), "released");
    // The 80k is back: another 90k booking fits.
    const next = await newBooking(tx, { total: 90000 });
    await holdFor(tx, budget, next, 90000);

    const direct = await newBooking(tx, { status: "PENDING", total: 5000 });
    assert.equal((await holdFor(tx, budget, direct, 5000)).rows[0].status, "committed", "a booking that needed no approval commits at once");
  });
});

test("db: a hold must match the budget's team and period", async () => {
  await scratch(async (tx) => {
    const { id: budget } = await newBudget(tx);
    await tx.query("savepoint s");
    await assert.rejects(holdFor(tx, budget, await newBooking(tx, { department: SALES }), 1000), /another department/);
    await tx.query("rollback to savepoint s");
    await assert.rejects(holdFor(tx, budget, await newBooking(tx, { date: "2027-01-10" }), 1000), /covers 2026-10-01 to 2026-12-31/);
  });
});

test("db: replace_approval_chain reorders atomically and refuses duplicates", async () => {
  await scratch(async (tx) => {
    await tx.query(`select replace_approval_chain($1, $2)`, [NIMBUS, [U.cfo, U.manager]]);
    const tiers = (await tx.query(`select approver_user_id, tier_level from approval_chains where tenant_id = $1 order by tier_level`, [NIMBUS])).rows;
    assert.deepEqual(tiers.map((t) => [t.approver_user_id, t.tier_level]), [[U.cfo, 1], [U.manager, 2]]);
    await assert.rejects(tx.query(`select replace_approval_chain($1, $2)`, [NIMBUS, [U.cfo, U.cfo]]), /only one tier/);
  });
});

test("db: RLS — a company reads its own rules, budgets and holds; nobody else does; portal users can't write them", async () => {
  const { id: budget } = await newBudget(db, { department: "dddddddd-0003-4000-8000-000000000003" });
  const rule = await newRule(db, { min: 9e8 });
  const booking = await newBooking(db, { total: 1000, department: "dddddddd-0003-4000-8000-000000000003" });
  await holdFor(db, budget, booking, 1000);
  try {
    const count = (user, table) => asUser(db, user ? { claims: { sub: user } } : { role: "anon" }, async (tx) => Number((await one(tx, `select count(*) n from ${table}`)).n));
    for (const table of ["approval_policy_rules", "team_budgets", "budget_holds"]) {
      assert.ok((await count(U.organizer, table)) >= 1, `own company reads ${table}`);
      assert.equal(await count(U.vertexUser, table), 0, `another company can't read ${table}`);
      assert.equal(await count(null, table), 0, `anon can't read ${table}`);
    }
    await assert.rejects(
      asUser(db, { claims: { sub: U.manager } }, (tx) => tx.query(`insert into approval_policy_rules (tenant_id, name, approval_levels) values ($1, 'x', 1)`, [NIMBUS])),
      /row-level security/
    );
    // No update policy for portal users: the row is invisible to the update, so nothing changes.
    const updated = await asUser(db, { claims: { sub: U.manager } }, (tx) => tx.query(`update team_budgets set limit_inr = 1e9 where id = $1 returning id`, [budget]));
    assert.equal(updated.rows.length, 0);
    assert.equal(Number((await one(db, `select limit_inr from team_budgets where id = $1`, [budget])).limit_inr), 100000);
  } finally {
    await db.query(`delete from bookings where id = $1`, [booking]);
    await db.query(`delete from team_budgets where id = $1`, [budget]);
    await db.query(`delete from approval_policy_rules where id = $1`, [rule]);
  }
});
