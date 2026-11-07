import assert from "node:assert/strict";
import test from "node:test";

import { opsBriefEmail, opsQuoteEmail, QuoteRequest, requesterReceipt } from "../lib/concierge/request.ts";

const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const id = "7d3c1f9e-2b4a-4c8d-9e1f-0a1b2c3d4e5f";

test("quote requests need a future date and a guest count; budget is optional", () => {
  const r = QuoteRequest.parse({ venueId: id, date: future, guests: "40", perHead: "", notes: " private room " });
  assert.deepEqual(r, { venueId: id, date: future, guests: 40, perHead: null, notes: "private room" });
  assert.equal(QuoteRequest.safeParse({ venueId: id, date: "2020-01-01", guests: "40", perHead: "", notes: "" }).success, false);
  assert.equal(QuoteRequest.safeParse({ venueId: id, date: future, guests: "1", perHead: "", notes: "" }).success, false);
  assert.equal(QuoteRequest.parse({ venueId: id, date: future, guests: "40", perHead: "2500", notes: "" }).perHead, 2500);
});

test("ops email carries everything needed to call the venue", () => {
  const r = QuoteRequest.parse({ venueId: id, date: future, guests: "40", perHead: "2500", notes: "Jain options" });
  const m = opsQuoteEmail({ companyName: "Nack", requesterEmail: "priya@nack.in" }, { name: "Toit", area: "Indiranagar", address: "298, 100 Feet Road" }, r);
  assert.match(m.subject, /^Quote request: Toit, 40 guests, .+ \(Nack\)$/);
  const text = m.lines.join("\n");
  for (const bit of ["priya@nack.in at Nack", "Toit, Indiranagar", "298, 100 Feet Road", "Guests: 40", "₹2,500 per head", "Notes: Jain options"]) assert.ok(text.includes(bit), bit);
});

test("brief email flags when no venue could quote", () => {
  assert.match(opsBriefEmail({ companyName: "Nack", requesterEmail: "a@nack.in" }, "Dinner for 30", 0).subject, /no venue could quote/);
  assert.doesNotMatch(opsBriefEmail({ companyName: "Nack", requesterEmail: "a@nack.in" }, "Dinner for 30", 2).subject, /no venue/);
  assert.match(requesterReceipt("Toit").lines.join(" "), /request for Toit/);
});
