// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { validateBookingForm } from "../lib/bookings/request-schema.ts";
import {
  describePolicyChecks,
  evaluateBookingPolicy,
  perHeadTier,
  policyMetadata,
  policyStatusOf,
  weekdayOf,
  withinEventHours,
} from "../lib/policies/evaluate-booking-policy.ts";
import { POLICY_TONE, venuePolicyStatus } from "../lib/venues/discovery.ts";
import { asUser, createDatabase } from "./support/supabase-pglite.mjs";

/** No caps or thresholds: only the rule under test applies. */
const BASE = { max_budget_per_head: null, requires_approval_above: null };
const TIERS = { ...BASE, auto_approval_limit_per_head: 1500, manager_approval_limit_per_head: 3000 };
const event = (perHead, extra = {}) => ({ total_amount: perHead * 20, headcount: 20, per_head_amount: perHead, ...extra });

// 2026-11-04 is a Wednesday, 2026-11-07 a Saturday.
const WEDNESDAY = "2026-11-04";
const SATURDAY = "2026-11-07";

// --- per-head approval tiers -----------------------------------------------------

test("per-head tiers: up to ₹1,500 auto-approved, up to ₹3,000 manager, above that CFO", () => {
  assert.deepEqual(evaluateBookingPolicy(TIERS, event(1500)), { requiresApproval: false });

  const manager = evaluateBookingPolicy(TIERS, event(1501));
  assert.equal(manager.tiers, 1);
  assert.deepEqual(manager.codes, ["PER_HEAD_MANAGER_TIER"]);
  assert.match(manager.reason, /above the ₹1,500(\.00)? auto-approval limit \(manager sign-off up to ₹3,000/);
  assert.equal(evaluateBookingPolicy(TIERS, event(3000)).tiers, 1);

  const cfo = evaluateBookingPolicy(TIERS, event(3001));
  assert.equal(cfo.tiers, 2);
  assert.deepEqual(cfo.codes, ["PER_HEAD_CFO_TIER"]);
  assert.match(cfo.reason, /CFO sign-off/);
});

test("tiers are off unless set: null limits never trigger (existing tenants unaffected)", () => {
  assert.deepEqual(evaluateBookingPolicy(BASE, event(50_000)), { requiresApproval: false });
  // Only a manager limit: everything up to it is auto-approved.
  assert.equal(perHeadTier({ manager_approval_limit_per_head: 3000 }, 2999).status, "in_policy");
  assert.equal(perHeadTier({ manager_approval_limit_per_head: 3000 }, 3001).status, "requires_cfo");
  // Only an auto limit: above it is manager sign-off, never CFO.
  assert.equal(perHeadTier({ auto_approval_limit_per_head: 1500 }, 99_999).status, "requires_manager");
});

test("stored outcome: status and codes per result", () => {
  assert.equal(policyStatusOf({ requiresApproval: false }), "in_policy");
  assert.deepEqual(policyMetadata(evaluateBookingPolicy(TIERS, event(2000))), { policy_status: "requires_manager", policy_violation_reasons: ["PER_HEAD_MANAGER_TIER"] });
  assert.deepEqual(policyMetadata(evaluateBookingPolicy(TIERS, event(4000))), { policy_status: "requires_cfo", policy_violation_reasons: ["PER_HEAD_CFO_TIER"] });
  assert.deepEqual(policyMetadata(evaluateBookingPolicy({ ...BASE, alcohol_policy: "prohibited" }, event(100, { alcohol_included: true }))), {
    policy_status: "out_of_policy",
    policy_violation_reasons: ["ALCOHOL_PROHIBITED"],
  });
});

test("every breach is listed with its code; any senior breach makes it CFO", () => {
  const r = evaluateBookingPolicy({ ...TIERS, max_budget_per_head: 2500, high_value_threshold: 100_000 }, event(2800, { total_amount: 150_000 }));
  assert.deepEqual(r.codes, ["EXCEEDS_PER_HEAD_CAP", "PER_HEAD_MANAGER_TIER", "ABOVE_HIGH_VALUE_THRESHOLD"]);
  assert.equal(r.tiers, 2);
});

// --- event context ---------------------------------------------------------------

test("open bar on a weekday: allowed, needs sign-off, or blocked; weekends are unaffected", () => {
  const drinks = (date) => event(1000, { alcohol_included: true, event_date: date });
  assert.equal(evaluateBookingPolicy({ ...BASE, weekday_open_bar_policy: "allowed" }, drinks(WEDNESDAY)).requiresApproval, false);

  const approval = evaluateBookingPolicy({ ...BASE, weekday_open_bar_policy: "approval" }, drinks(WEDNESDAY));
  assert.deepEqual(approval.codes, ["OPEN_BAR_WEEKDAY"]);
  assert.match(approval.reason, /weekday \(Wednesday\)/);
  assert.equal(evaluateBookingPolicy({ ...BASE, weekday_open_bar_policy: "approval" }, drinks(SATURDAY)).requiresApproval, false);

  const blocked = evaluateBookingPolicy({ ...BASE, weekday_open_bar_policy: "prohibited" }, drinks(WEDNESDAY));
  assert.equal(blocked.blocked, true);
  assert.deepEqual(blocked.codes, ["OPEN_BAR_WEEKDAY"]);
  assert.equal(evaluateBookingPolicy({ ...BASE, weekday_open_bar_policy: "prohibited" }, event(1000, { event_date: WEDNESDAY })).requiresApproval, false);
});

test("weekdayOf: Monday–Friday only", () => {
  assert.equal(weekdayOf("2026-11-02"), "Monday");
  assert.equal(weekdayOf("2026-11-06"), "Friday");
  assert.equal(weekdayOf(SATURDAY), null);
  assert.equal(weekdayOf(undefined), null);
});

test("restricted event types need sign-off", () => {
  const rules = { ...BASE, restricted_event_types: ["client_entertainment"] };
  const r = evaluateBookingPolicy(rules, event(1000, { event_type: "client_entertainment" }));
  assert.deepEqual(r.codes, ["RESTRICTED_EVENT_TYPE"]);
  assert.match(r.reason, /client entertainment events need sign-off/);
  assert.equal(evaluateBookingPolicy(rules, event(1000, { event_type: "team_meal" })).requiresApproval, false);
});

test("event hours: outside the window needs sign-off; windows may wrap midnight; no start time isn't flagged", () => {
  const rules = { ...BASE, event_hours_start: "11:00:00", event_hours_end: "22:00:00" };
  assert.equal(evaluateBookingPolicy(rules, event(1000, { event_start_time: "19:30" })).requiresApproval, false);
  const late = evaluateBookingPolicy(rules, event(1000, { event_start_time: "22:30" }));
  assert.deepEqual(late.codes, ["OUTSIDE_EVENT_HOURS"]);
  assert.match(late.reason, /starts at 22:30, outside the 11:00–22:00 event hours/);
  assert.equal(evaluateBookingPolicy(rules, event(1000)).requiresApproval, false);

  assert.equal(withinEventHours("23:30", "18:00", "01:00"), true);
  assert.equal(withinEventHours("00:30", "18:00", "01:00"), true);
  assert.equal(withinEventHours("12:00", "18:00", "01:00"), false);
});

test("venues beyond the office radius need sign-off", () => {
  const rules = { ...BASE, max_office_distance_km: 15 };
  assert.deepEqual(evaluateBookingPolicy(rules, event(1000, { distance_from_office_km: 22.4 })).codes, ["BEYOND_OFFICE_DISTANCE"]);
  assert.equal(evaluateBookingPolicy(rules, event(1000, { distance_from_office_km: 4 })).requiresApproval, false);
  assert.equal(evaluateBookingPolicy(rules, event(1000, { distance_from_office_km: null })).requiresApproval, false);
});

test("describePolicyChecks itemises the new rules for the banner", () => {
  const rules = { ...TIERS, weekday_open_bar_policy: "approval", restricted_event_types: ["offsite"], event_hours_start: "11:00", event_hours_end: "22:00", max_office_distance_km: 15 };
  const checks = describePolicyChecks(rules, {
    total_amount: 40_000,
    per_head_amount: 2000,
    alcohol_included: true,
    event_date: WEDNESDAY,
    event_type: "offsite",
    event_start_time: "20:00",
    distance_from_office_km: 3.2,
  });
  const byRule = Object.fromEntries(checks.map((c) => [c.rule, c]));
  assert.equal(byRule.per_head_tier.ok, false);
  assert.match(byRule.per_head_tier.detail, /auto-approval limit/);
  assert.equal(byRule.weekday_alcohol.ok, false);
  assert.equal(byRule.event_type.ok, false);
  assert.equal(byRule.event_hours.ok, true);
  assert.equal(byRule.office_distance.ok, true);
  assert.equal(describePolicyChecks(BASE, { total_amount: 1, per_head_amount: 1 }).length, 0);
});

// --- venue cards ------------------------------------------------------------------

test("venue cards: green / amber with the band / red, from the cheapest package", () => {
  const card = (from) => venuePolicyStatus(TIERS, { from_per_head_inr: from, min_spend_inr: 0 });
  assert.deepEqual(card(1500), { status: "in_policy" });
  const amber = card(2200);
  assert.equal(amber.status, "requires_manager");
  assert.equal(amber.range, "₹1,500–₹3,000/head");
  const red = card(4200);
  assert.equal(red.status, "requires_cfo");
  assert.equal(red.range, ">₹3,000/head");
  assert.deepEqual([POLICY_TONE.in_policy, POLICY_TONE.requires_manager, POLICY_TONE.requires_cfo], ["ok", "warn", "error"]);
});

test("venue cards: a high minimum spend means CFO; a far venue means manager", () => {
  assert.equal(venuePolicyStatus({ ...BASE, high_value_threshold: 200_000 }, { from_per_head_inr: null, min_spend_inr: 250_000 }).status, "requires_cfo");
  const far = venuePolicyStatus({ ...BASE, max_office_distance_km: 10 }, { from_per_head_inr: null, min_spend_inr: 0 }, 18.5);
  assert.equal(far.status, "requires_manager");
  assert.match(far.reason, /18\.5 km from the office/);
});

// --- booking form -----------------------------------------------------------------

test("booking form: event type, start time and alcohol are optional but validated", () => {
  const valid = {
    venue_id: "aaaaaaaa-0001-4000-8000-000000000001",
    event_date: "2026-11-06",
    party_size: "40",
    budget_per_head_inr: "2500",
    event_type: "offsite",
    event_start_time: "19:30",
    alcohol_included: "on",
    department_id: "",
    cost_center: "ENG",
    project_code: "",
    billing_gstin: "",
    contact_phone: "",
    notes: "",
  };
  const ctx = { today: "2026-10-08" };
  const r = validateBookingForm(valid, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.event_type, r.value.event_start_time, r.value.alcohol_included], ["offsite", "19:30", true]);
  assert.match(validateBookingForm({ ...valid, event_type: "rave" }, ctx).errors.event_type, /event type/);
  assert.match(validateBookingForm({ ...valid, event_start_time: "7pm" }, ctx).errors.event_start_time, /19:30/);
});

// --- schema and multi-tenant RLS, against PGlite with every migration applied ------

const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const A = "b0000000-0000-4000-8000-00000000000a"; // Nimbus organizer
const B = "b0000000-0000-4000-8000-00000000000b"; // Vertex organizer

let db;
before(async () => {
  db = await createDatabase();
  for (const [id, email] of [[A, "a@nimbus.test"], [B, "b@vertex.test"]]) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  await db.query(
    `insert into platform_users (user_id, role, company_id, corporate_role) values ($1, 'CLIENT', $2, 'ORGANIZER'), ($3, 'CLIENT', $4, 'ORGANIZER')`,
    [A, NIMBUS, B, VERTEX]
  );
  // Vertex gets a negotiated rate too, so isolation is checked both ways.
  await db.query(`insert into corporate_rate_cards (tenant_id, venue_id, discount_percentage, effective_from) values ($1, 'aaaaaaaa-0005-4000-8000-000000000005', 10, '2026-01-01')`, [VERTEX]);
});

const as = (user, fn) => asUser(db, { claims: { sub: user } }, fn);
const rows = async (user, sql, params) => as(user, async (tx) => (await tx.query(sql, params)).rows);

test("seed: both demo companies have ₹1,500 / ₹3,000 tiers; the new rules default to off", async () => {
  const { rows: policies } = await db.query(
    `select tenant_id, auto_approval_limit_per_head::float8 auto, manager_approval_limit_per_head::float8 manager,
            max_office_distance_km, event_hours_start, weekday_open_bar_policy, restricted_event_types
     from corporate_policies order by tenant_id`
  );
  assert.equal(policies.length, 2);
  for (const p of policies) {
    assert.deepEqual([p.auto, p.manager], [1500, 3000]);
    assert.deepEqual([p.max_office_distance_km, p.event_hours_start, p.weekday_open_bar_policy, p.restricted_event_types], [null, null, "allowed", []]);
  }
});

test("schema: tiers must be ordered, event hours paired, and statuses / event types valid", async () => {
  await assert.rejects(db.query(`update corporate_policies set auto_approval_limit_per_head = 5000 where tenant_id = $1`, [NIMBUS]), /per_head_tiers_ordered/);
  await assert.rejects(db.query(`update corporate_policies set event_hours_start = '11:00' where tenant_id = $1`, [NIMBUS]), /event_hours_paired/);
  await assert.rejects(db.query(`update corporate_policies set restricted_event_types = '{rave}' where tenant_id = $1`, [NIMBUS]), /check constraint/);
  await assert.rejects(db.query(`update bookings set policy_status = 'vibes' where company_id = $1`, [NIMBUS]), /check constraint/);
  const { rows: rfpChecks } = await db.query(`select pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'public.rfps'::regclass and contype = 'c'`);
  assert.ok(rfpChecks.some((c) => /event_type/.test(c.def) && /client_entertainment/.test(c.def)));
  assert.ok(rfpChecks.some((c) => /policy_status/.test(c.def) && /requires_cfo/.test(c.def)));
  const { rows: [b] } = await db.query(`select policy_status, policy_violation_reasons from bookings limit 1`);
  assert.deepEqual(b, { policy_status: null, policy_violation_reasons: [] });
});

test("RLS: each company reads only its own policy rules", async () => {
  assert.deepEqual((await rows(A, `select tenant_id from corporate_policies`)).map((r) => r.tenant_id), [NIMBUS]);
  assert.deepEqual((await rows(B, `select tenant_id from corporate_policies`)).map((r) => r.tenant_id), [VERTEX]);
  assert.deepEqual(await rows(B, `select * from corporate_policies where tenant_id = $1`, [NIMBUS]), []);
  assert.deepEqual(await rows(A, `select * from corporate_policies where tenant_id = $1`, [VERTEX]), []);
});

test("RLS: each company reads only its own negotiated venue rates", async () => {
  const nimbusCards = Number((await db.query(`select count(*) n from corporate_rate_cards where tenant_id = $1`, [NIMBUS])).rows[0].n);
  assert.ok(nimbusCards > 0);
  const seenByA = await rows(A, `select tenant_id from corporate_rate_cards`);
  assert.equal(seenByA.length, nimbusCards);
  assert.ok(seenByA.every((r) => r.tenant_id === NIMBUS));
  assert.deepEqual((await rows(B, `select tenant_id from corporate_rate_cards`)).map((r) => r.tenant_id), [VERTEX]);
  assert.deepEqual(await rows(B, `select * from corporate_rate_cards where tenant_id = $1`, [NIMBUS]), []);
});

test("RLS: employees can't change policy rules, their own company's or anyone else's", async () => {
  for (const [user, tenant] of [[A, NIMBUS], [A, VERTEX], [B, NIMBUS]]) {
    const updated = await rows(user, `update corporate_policies set auto_approval_limit_per_head = 0, manager_approval_limit_per_head = 1000000 where tenant_id = $1 returning id`, [tenant]);
    assert.deepEqual(updated, [], `${user} → ${tenant}`);
  }
  await assert.rejects(as(B, (tx) => tx.query(`insert into corporate_policies (tenant_id) values ($1)`, [NIMBUS])), /row-level security/);
  assert.deepEqual(await rows(A, `delete from corporate_policies where tenant_id = $1 returning id`, [NIMBUS]), []);
  const { rows: [nimbus] } = await db.query(`select auto_approval_limit_per_head::float8 auto from corporate_policies where tenant_id = $1`, [NIMBUS]);
  assert.equal(nimbus.auto, 1500);
});

test("RLS: a company's bookings' policy outcomes stay private to it", async () => {
  await db.query(`update bookings set policy_status = 'requires_cfo', policy_violation_reasons = '{PER_HEAD_CFO_TIER}' where company_id = $1`, [NIMBUS]);
  try {
    assert.deepEqual(await rows(B, `select policy_status from bookings where company_id = $1`, [NIMBUS]), []);
    assert.ok((await rows(A, `select policy_status from bookings where policy_status = 'requires_cfo'`)).length > 0);
  } finally {
    await db.query(`update bookings set policy_status = null, policy_violation_reasons = '{}'`);
  }
});
