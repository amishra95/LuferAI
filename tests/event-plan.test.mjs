import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInBlocker, EMPTY_PLAN, planDiffers, planStatus, signOffBlocker, validatePlan, venueAckBlocker } from "../lib/events/plan.ts";
import { depositReadiness, invoiceLines, receiptReadiness } from "../lib/events/finance.ts";
import { summarizeDietary } from "../lib/events/rsvp.ts";

const plan = (p) => ({ ...EMPTY_PLAN, ...p });

// --- the plan form ------------------------------------------------------------------

test("validatePlan drops blank rows, tidies text and sorts the run of show by time", () => {
  const r = validatePlan({
    runOfShow: [
      { time: "20:30", item: "  Dinner   served " },
      { time: "", item: "" },
      { time: "19:00", item: "Guests arrive" },
    ],
    cateringPackageId: " pkg-1 ",
    specialRequirements: "Stage for 4\r\nWheelchair access  ",
  });
  assert.deepEqual(r, {
    ok: true,
    value: {
      runOfShow: [
        { time: "19:00", item: "Guests arrive" },
        { time: "20:30", item: "Dinner served" },
      ],
      cateringPackageId: "pkg-1",
      specialRequirements: "Stage for 4\nWheelchair access",
    },
  });
});

test("validatePlan explains bad rows and limits", () => {
  assert.match(validatePlan({ runOfShow: [{ time: "7pm", item: "Arrive" }] }).error, /Row 1: enter a time as HH:MM/);
  assert.match(validatePlan({ runOfShow: [{ time: "19:00", item: "" }] }).error, /Row 1: say what happens at 19:00/);
  assert.match(validatePlan({ runOfShow: [{ time: "19:00", item: "x".repeat(121) }] }).error, /under 120/);
  assert.match(validatePlan({ runOfShow: Array.from({ length: 31 }, (_, i) => ({ time: "19:00", item: `Item ${i}` })) }).error, /up to 30/);
  assert.match(validatePlan({ specialRequirements: "x".repeat(1001) }).error, /at most 1000/);
  assert.deepEqual(validatePlan({}), { ok: true, value: { runOfShow: [], cateringPackageId: null, specialRequirements: "" } });
});

test("planDiffers notices content changes only", () => {
  const a = { runOfShow: [{ time: "19:00", item: "Arrive" }], cateringPackageId: "p", specialRequirements: "" };
  assert.equal(planDiffers(a, { ...a, runOfShow: [{ time: "19:00", item: "Arrive" }] }), false);
  assert.equal(planDiffers(a, { ...a, runOfShow: [{ time: "19:15", item: "Arrive" }] }), true);
  assert.equal(planDiffers(a, { ...a, cateringPackageId: null }), true);
  assert.equal(planDiffers(a, { ...a, specialRequirements: "AV" }), true);
});

// --- sign-off --------------------------------------------------------------------------

const drafted = plan({ runOfShow: [{ time: "19:00", item: "Arrive" }], revision: 2 });

test("planStatus walks empty → draft → approved → changed, and tracks the venue", () => {
  assert.equal(planStatus(EMPTY_PLAN).stage, "empty");
  assert.equal(planStatus(drafted).stage, "draft");
  const approved = { ...drafted, approvedRevision: 2 };
  assert.deepEqual(planStatus(approved), { stage: "approved", venueAcknowledged: false, label: "Signed off · with the venue" });
  assert.equal(planStatus({ ...approved, venueAckRevision: 2 }).venueAcknowledged, true);
  // Edited after sign-off: the old approval no longer covers it, nor does the venue's confirmation.
  const edited = { ...approved, venueAckRevision: 2, revision: 3 };
  assert.deepEqual(planStatus(edited), { stage: "changed", venueAcknowledged: false, label: "Changed since sign-off" });
});

test("only Approvers sign off, and only a plan with something in it", () => {
  assert.equal(signOffBlocker("APPROVER", drafted), null);
  assert.match(signOffBlocker("ORGANIZER", drafted), /Only an Approver/);
  assert.match(signOffBlocker("FINANCE_VIEWER", drafted), /read-only/);
  assert.match(signOffBlocker(null, drafted), /read-only/);
  assert.match(signOffBlocker("APPROVER", EMPTY_PLAN), /Add a run of show/);
  assert.match(signOffBlocker("APPROVER", { ...drafted, approvedRevision: 2 }), /Already signed off/);
  assert.equal(signOffBlocker("APPROVER", { ...drafted, approvedRevision: 1 }), null); // changed since: sign off again
});

test("the venue confirms only the signed-off revision in force", () => {
  assert.match(venueAckBlocker(drafted), /hasn't signed off/);
  assert.equal(venueAckBlocker({ ...drafted, approvedRevision: 2 }), null);
  assert.match(venueAckBlocker({ ...drafted, approvedRevision: 2, venueAckRevision: 2 }), /Already confirmed/);
  assert.match(venueAckBlocker({ ...drafted, approvedRevision: 1 }), /hasn't signed off/);
});

test("check-in opens on the event day for bookings that went ahead", () => {
  assert.equal(checkInBlocker("CONFIRMED", "2026-10-12", "2026-10-12"), null);
  assert.equal(checkInBlocker("COMPLETED", "2026-10-01", "2026-10-12"), null);
  assert.match(checkInBlocker("CONFIRMED", "2026-10-20", "2026-10-12"), /event day/);
  assert.match(checkInBlocker("PENDING", "2026-10-01", "2026-10-12"), /venue confirms/);
  assert.match(checkInBlocker("CANCELLED", "2026-10-01", "2026-10-12"), /venue confirms/);
});

// --- money --------------------------------------------------------------------------

const head = (rate_percent, amount) => ({ rate_percent, amount });
const sum = (lines) => Math.round(lines.filter((l) => l.kind === "subtotal" || l.kind === "tax").reduce((t, l) => t + l.amount, 0) * 100) / 100;

test("invoiceLines: intra-state, no rate card", () => {
  const lines = invoiceLines({
    party_size: 60,
    budget_per_head_inr: 1800,
    list_budget_per_head_inr: null,
    invoice: { taxable_value: 108000, gst_type: "CGST_SGST", tax_breakup: { cgst: head(9, 9720), sgst: head(9, 9720), igst: head(0, 0) }, invoice_total: 127440 },
  });
  assert.deepEqual(
    lines.map((l) => [l.label, l.amount]),
    [
      ["Venue price (taxable)", 108000],
      ["CGST 9%", 9720],
      ["SGST 9%", 9720],
      ["Invoice total", 127440],
    ]
  );
  assert.equal(lines[0].detail, "60 guests × ₹1,800");
  assert.equal(sum(lines), 127440);
});

test("invoiceLines: inter-state with a rate-card discount still sums to the total", () => {
  const lines = invoiceLines({
    party_size: 40,
    budget_per_head_inr: 2250,
    list_budget_per_head_inr: 2500,
    invoice: { taxable_value: 90000, gst_type: "IGST", tax_breakup: { cgst: head(0, 0), sgst: head(0, 0), igst: head(18, 16200) }, invoice_total: 106200 },
  });
  assert.deepEqual(
    lines.map((l) => [l.kind, l.amount]),
    [
      ["list", 100000],
      ["discount", -10000],
      ["subtotal", 90000],
      ["tax", 16200],
      ["total", 106200],
    ]
  );
  assert.equal(lines[3].label, "IGST 18%");
  assert.equal(sum(lines), 106200);
});

test("depositReadiness and receiptReadiness name each state", () => {
  assert.equal(depositReadiness("CONFIRMED", { status: "captured", amount_inr: 38232 }, true).label, "Deposit paid · ₹38,232");
  assert.equal(depositReadiness("PENDING", { status: "authorized", amount_inr: 100 }, true).tone, "pending");
  assert.equal(depositReadiness("PENDING", null, true).label, "Deposit due");
  assert.equal(depositReadiness("PENDING_APPROVAL", null, true).label, "Deposit after sign-off");
  assert.equal(depositReadiness("PENDING", null, false).label, "No online deposit");
  assert.equal(depositReadiness("CONFIRMED", { status: "failed", amount_inr: 1 }, true).tone, "problem");

  assert.equal(receiptReadiness("PENDING", null).label, "Invoice on confirmation");
  assert.equal(receiptReadiness("CONFIRMED", null).label, "Invoice issued · receipt pending");
  assert.equal(receiptReadiness("CONFIRMED", "delivered").label, "Receipt ready");
  assert.equal(receiptReadiness("CONFIRMED", "failed").tone, "problem");
  assert.equal(receiptReadiness("CANCELLED", null).label, "No invoice");
});

// --- dietary summary -------------------------------------------------------------------

test("summarizeDietary counts needs of guests coming, case-insensitively", () => {
  const d = summarizeDietary([
    { rsvp_status: "ACCEPTED", dietary: "Vegetarian, nut allergy" },
    { rsvp_status: "TENTATIVE", dietary: "vegetarian; Jain." },
    { rsvp_status: "ACCEPTED", dietary: "Jain" },
    { rsvp_status: "DECLINED", dietary: "Vegan" },
    { rsvp_status: "INVITED", dietary: "Halal" },
    { rsvp_status: "ACCEPTED", dietary: null },
  ]);
  assert.deepEqual(d, [
    { need: "Jain", count: 2 },
    { need: "Vegetarian", count: 2 },
    { need: "Nut allergy", count: 1 },
  ]);
});
