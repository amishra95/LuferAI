import assert from "node:assert/strict";
import test from "node:test";

import { bookingRequestAlert, rfpAlert } from "../lib/venues/alert-messages.ts";

const base = {
  venueName: "Toit",
  companyName: "Nack Private Limited",
  eventDate: "2026-12-04",
  guests: 40,
  perHead: 2000,
  taxable: 80000,
  payout: 68000,
  notes: "Jain options",
  holdExpiresAt: new Date("2026-11-20T10:30:00Z"),
};

test("booking request alert: who, when, money, deadline, link", () => {
  const m = bookingRequestAlert(base, "https://lufer.app/property");
  assert.match(m.subject, /^New request: Nack, 40 guests, /);
  const text = m.lines.join("\n");
  for (const bit of ["Nack wants Toit for 40 guests", "₹2,000 a head", "₹80,000 before GST", "You receive: ₹68,000", "Notes: Jain options", "held for you until", "https://lufer.app/property"]) {
    assert.ok(text.includes(bit), bit);
  }
  assert.doesNotMatch(text, /Lufer concierge/);
});

test("alerts sent to the concierge say so first", () => {
  assert.match(bookingRequestAlert(base, "x", true).lines[0], /No manager is set up for Toit/);
  assert.match(rfpAlert({ venueName: "Toit", companyName: "Nack", guests: 30, eventDate: null, perHead: null }, "x", true).lines[0], /concierge/);
});

test("RFP alert: the instant price sent, or a request for one, and the no-login link", () => {
  const quoted = rfpAlert({ venueName: "Toit", companyName: "Nack", guests: 30, eventDate: "2026-12-04", perHead: 1800 }, "https://lufer.app/quote/abc");
  assert.match(quoted.subject, /^Quote request: Nack, 30 guests on /);
  assert.ok(quoted.lines.join(" ").includes("your standard price of ₹1,800 a head"));
  assert.ok(quoted.lines.includes("https://lufer.app/quote/abc"));
  const open = rfpAlert({ venueName: "Toit", companyName: "Nack", guests: 30, eventDate: null, perHead: null }, "u");
  assert.ok(open.lines.join(" ").includes("waiting for your price"));
});
