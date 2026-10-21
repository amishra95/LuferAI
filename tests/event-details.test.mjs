import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetCapError, composeEventNotes, EMPTY_EVENT_DETAILS, eventDetailsErrors } from "../lib/bookings/event-details.ts";
import { NOTES_MAX } from "../lib/bookings/request-schema.ts";

const details = (over = {}) => ({ ...EMPTY_EVENT_DETAILS, ...over });

test("composeEventNotes: no details leaves the notes as typed", () => {
  assert.equal(composeEventNotes(details(), "  Window table please "), "Window table please");
  assert.equal(composeEventNotes(details(), ""), "");
});

test("composeEventNotes: one line per detail, then the notes", () => {
  const notes = composeEventNotes(
    details({ occasion: "Team dinner", startTime: "19:30", endTime: "22:00", seating: "private", food: ["veg", "alcohol"], dietary: "2 vegan, 1 nut allergy", budgetCap: "240000" }),
    "Projector needed"
  );
  assert.equal(
    notes,
    "Occasion: Team dinner\nTime: 19:30–22:00\nSeating: Private dining\nFood & drink: Veg, Alcohol\nDietary: 2 vegan, 1 nut allergy\nBudget cap: ₹2,40,000 (pre-tax)\n\nProjector needed"
  );
});

test("eventDetailsErrors: time format and order, cap amount, combined length", () => {
  assert.deepEqual(eventDetailsErrors(details({ startTime: "19:30", endTime: "22:00", budgetCap: "5000" }), ""), {});
  assert.equal(eventDetailsErrors(details({ startTime: "22:00", endTime: "19:00" }), "").endTime, "Ends after it starts");
  assert.ok(eventDetailsErrors(details({ startTime: "25:00" }), "").startTime);
  assert.ok(eventDetailsErrors(details({ budgetCap: "-5" }), "").budgetCap);
  assert.ok(eventDetailsErrors(details({ occasion: "Team dinner" }), "x".repeat(NOTES_MAX)).notes);
});

test("budgetCapError: guests × per head against the cap", () => {
  assert.equal(budgetCapError({ partySize: 40, perHead: 6000, cap: 240000 }), null);
  assert.match(budgetCapError({ partySize: 40, perHead: 6500, cap: 240000 }), /₹2,60,000, over your ₹2,40,000 cap/);
  assert.equal(budgetCapError({ partySize: 40, perHead: 6500, cap: null }), null);
});
