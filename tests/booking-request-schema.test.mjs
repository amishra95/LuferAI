import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_STEPS, bookingFormInput, stepOf, validateBookingForm, validateBookingStep } from "../lib/bookings/request-schema.ts";

const VENUE = "aaaaaaaa-0001-4000-8000-000000000001";
const NIMBUS_GSTIN = "29AABCN4821K1ZA";
const ctx = { today: "2026-10-08", capacity: 80, venueName: "The Copper Courtyard", companyGstin: NIMBUS_GSTIN };
const valid = {
  venue_id: VENUE,
  event_date: "2026-11-06",
  party_size: "40",
  budget_per_head_inr: "2500",
  department_id: "",
  cost_center: " eng-blr ",
  project_code: "",
  billing_gstin: "",
  notes: "  PDR please  ",
};

test("a complete request parses to typed, normalised values", () => {
  const r = validateBookingForm(valid, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    venue_id: VENUE,
    event_date: "2026-11-06",
    party_size: 40,
    budget_per_head_inr: 2500,
    department_id: null,
    cost_center: "eng-blr",
    project_code: "",
    billing_gstin: "",
    notes: "PDR please",
  });
});

test("messages match placeBookingRequest's", () => {
  const r = validateBookingForm({ ...valid, venue_id: "", event_date: "2026-10-08", party_size: "2.5", budget_per_head_inr: "0", cost_center: "" }, ctx);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, {
    venue_id: "Choose a venue",
    event_date: "Pick a future date",
    party_size: "Enter a whole number of guests",
    budget_per_head_inr: "Enter a budget per head",
    cost_center: "Enter a cost centre",
  });
});

test("capacity and same-legal-entity GSTIN are checked when the browser knows them", () => {
  assert.equal(validateBookingForm({ ...valid, party_size: "81" }, ctx).errors.party_size, "The Copper Courtyard seats up to 80");
  // Another company's GSTIN (different PAN).
  assert.match(validateBookingForm({ ...valid, billing_gstin: "07AAECV6730M1ZX" }, ctx).errors.billing_gstin, /different legal entity/);
  // Without context (server action) only the format is checked; placeBookingRequest checks the rest.
  assert.equal(validateBookingForm({ ...valid, party_size: "81", billing_gstin: "07AAECV6730M1ZX" }, { today: ctx.today }).ok, true);
  assert.match(validateBookingForm({ ...valid, billing_gstin: "NOTAGSTIN" }, { today: ctx.today }).errors.billing_gstin, /.+/);
});

test("per-step validation only reports that step's fields", () => {
  const incomplete = { ...valid, party_size: "", cost_center: "" };
  assert.deepEqual(Object.keys(validateBookingStep(incomplete, ctx, "event")), ["party_size"]);
  assert.deepEqual(Object.keys(validateBookingStep(incomplete, ctx, "billing")), ["cost_center"]);
  assert.deepEqual(validateBookingStep(incomplete, ctx, "review"), {});
  assert.deepEqual(validateBookingStep(valid, ctx, "event"), {});
});

test("department must be blank or an id; notes are capped", () => {
  assert.equal(validateBookingForm({ ...valid, department_id: "sales" }, ctx).errors.department_id, "Choose a department");
  assert.equal(validateBookingForm({ ...valid, department_id: VENUE }, ctx).value.department_id, VENUE);
  assert.match(validateBookingForm({ ...valid, notes: "x".repeat(501) }, ctx).errors.notes, /500/);
});

test("every field belongs to exactly one step; stepOf finds it", () => {
  const fields = BOOKING_STEPS.flatMap((s) => s.fields);
  assert.equal(new Set(fields).size, fields.length);
  assert.deepEqual(new Set(fields), new Set(Object.keys(valid)));
  assert.equal(stepOf("billing_gstin"), "billing");
  assert.equal(stepOf("event_date"), "event");
});

test("bookingFormInput reads FormData, treating missing fields as blank", () => {
  const fd = new FormData();
  fd.set("venue_id", VENUE);
  fd.set("party_size", "12");
  const input = bookingFormInput(fd);
  assert.equal(input.venue_id, VENUE);
  assert.equal(input.party_size, "12");
  assert.equal(input.notes, "");
});
