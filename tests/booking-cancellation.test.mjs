// Run with: npm test
//
// Company-side cancellation (lib/bookings/cancellation.ts) and withdrawing a
// concierge request (lib/concierge/requests.ts): which mode applies, who may
// do it, the refund shown, and the emails.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bookingReference,
  CancelInput,
  cancelModeFor,
  cancelRefusal,
  mayCancel,
  opsCancellationEmail,
  refundEstimate,
  refundLine,
  venueCancellationEmail,
} from "../lib/bookings/cancellation.ts";
import { isWithdrawable, mayWithdrawRequest } from "../lib/concierge/requests.ts";

const TODAY = "2026-11-11";
const CO = "c0000000-0000-4000-8000-000000000001";
const ME = "u0000000-0000-4000-8000-000000000001";
const OTHER = "u0000000-0000-4000-8000-000000000002";
const booking = (over = {}) => ({ company_id: CO, requested_by: ME, status: "PENDING", event_date: "2026-12-01", total_amount_inr: 100000, cancellation_requested_at: null, ...over });
const who = (over = {}) => ({ role: "CLIENT", userId: ME, companyId: CO, corporateRole: "ORGANIZER", ...over });

test("mode: cancel before the venue confirms, request after, nothing once it's over", () => {
  assert.equal(cancelModeFor(booking({ status: "PENDING_APPROVAL" }), TODAY), "cancel");
  assert.equal(cancelModeFor(booking({ status: "PENDING" }), TODAY), "cancel");
  assert.equal(cancelModeFor(booking({ status: "CONFIRMED" }), TODAY), "request");
  assert.equal(cancelModeFor(booking({ status: "CONFIRMED", event_date: TODAY }), TODAY), "request", "the day of the event still counts");
  assert.equal(cancelModeFor(booking({ status: "CONFIRMED", event_date: "2026-11-10" }), TODAY), null, "past events can't be cancelled");
  for (const status of ["COMPLETED", "SETTLED", "CANCELLED"]) assert.equal(cancelModeFor(booking({ status }), TODAY), null, status);
  assert.equal(cancelModeFor(booking({ status: "CONFIRMED" }), TODAY, { admin: true }), "cancel", "admins close confirmed bookings outright");
});

test("who: the requester or an Approver of the company; admins; never Finance viewers or other companies", () => {
  assert.equal(mayCancel(who(), booking()), true, "the organiser who requested it");
  assert.equal(mayCancel(who({ userId: OTHER }), booking()), false, "another organiser");
  assert.equal(mayCancel(who({ userId: OTHER, corporateRole: "APPROVER" }), booking()), true, "any Approver");
  assert.equal(mayCancel(who({ corporateRole: "FINANCE_VIEWER" }), booking()), false, "Finance viewers, even as requester");
  assert.equal(mayCancel(who({ corporateRole: "APPROVER", companyId: "c0000000-0000-4000-8000-000000000009" }), booking()), false, "another company");
  assert.equal(mayCancel({ role: "ADMIN", userId: OTHER, companyId: null, corporateRole: null }, booking()), true);
  assert.equal(mayCancel({ role: "PROPERTY", userId: ME, companyId: null, corporateRole: null }, booking()), false);
});

test("refusals explain what to do instead", () => {
  assert.equal(cancelRefusal(who(), booking(), TODAY), null);
  assert.match(cancelRefusal(who({ userId: OTHER }), booking(), TODAY), /requested this event, or an Approver/);
  assert.match(cancelRefusal(who(), booking({ status: "CANCELLED" }), TODAY), /already cancelled/);
  assert.match(cancelRefusal(who(), booking({ status: "COMPLETED" }), TODAY), /Email support/);
  assert.match(cancelRefusal(who(), booking({ status: "CONFIRMED", cancellation_requested_at: "2026-11-10T10:00:00Z" }), TODAY), /already requested/);
});

test("refund shown for a confirmed booking follows the venue's tiers", () => {
  const terms = [{ days_before: 14, refund_pct: 100 }, { days_before: 7, refund_pct: 50 }];
  const twenty = refundEstimate(terms, booking({ event_date: "2026-12-01" }), TODAY);
  assert.deepEqual([twenty.refundPct, twenty.refund], [100, 100000]);
  const ten = refundEstimate(terms, booking({ event_date: "2026-11-21" }), TODAY);
  assert.match(refundLine(ten), /^₹50,000(\.00)? \(50%\) under the venue's terms\.$/);
  assert.match(refundLine(refundEstimate(terms, booking({ event_date: "2026-11-13" }), TODAY)), /No refund at this notice/);
  assert.match(refundLine(refundEstimate([], booking(), TODAY)), /Lufer will confirm the amount/, "no tiers: nothing promised");
});

test("input: a booking id and an optional reason of at most 500 characters", () => {
  const id = "bbbbbbbb-0001-4000-8000-000000000001";
  assert.deepEqual(CancelInput.parse({ bookingId: id, reason: "  " }), { bookingId: id, reason: null });
  assert.equal(CancelInput.parse({ bookingId: id, reason: " Team offsite moved " }).reason, "Team offsite moved");
  assert.equal(CancelInput.safeParse({ bookingId: "nope" }).success, false);
  assert.equal(CancelInput.safeParse({ bookingId: id, reason: "x".repeat(501) }).success, false);
});

test("emails name the booking, and only the ops email carries the refund", () => {
  const base = { reference: bookingReference("bbbbbbbb-0001-4000-8000-000000000001"), venueName: "The Copper Courtyard", companyName: "Acme", eventDate: "2026-12-01", guests: 40, total: 100000, by: "a@acme.test", reason: "Moved online", refund: "₹50,000 (50%) under the venue's terms." };
  assert.equal(base.reference, "BBBBBBBB");
  const venue = venueCancellationEmail({ ...base, kind: "cancel" });
  assert.match(venue.subject, /^Request cancelled: Acme, 2026-12-01$/);
  assert.match(venue.lines.join("\n"), /date is free again[\s\S]*Booking BBBBBBBB[\s\S]*Reason: Moved online/);
  assert.doesNotMatch(venue.lines.join("\n"), /50%/);
  assert.match(venueCancellationEmail({ ...base, kind: "request" }).lines[0], /Lufer will contact you/);
  const ops = opsCancellationEmail({ ...base, kind: "request" });
  assert.match(ops.lines.join("\n"), /Refund due: ₹50,000 \(50%\)[\s\S]*Cancel booking/);
});

test("concierge requests: withdrawable until booked or closed, by the requester or an Approver", () => {
  for (const s of ["new", "working", "options_sent"]) assert.equal(isWithdrawable(s), true, s);
  for (const s of ["booked", "closed"]) assert.equal(isWithdrawable(s), false, s);
  const req = { company_id: CO, requested_by: ME };
  assert.equal(mayWithdrawRequest(who(), req), true);
  assert.equal(mayWithdrawRequest(who({ userId: OTHER }), req), false);
  assert.equal(mayWithdrawRequest(who({ userId: OTHER, corporateRole: "APPROVER" }), req), true);
  assert.equal(mayWithdrawRequest(who({ companyId: "c0000000-0000-4000-8000-000000000009", corporateRole: "APPROVER" }), req), false);
  assert.equal(mayWithdrawRequest({ role: "ADMIN", userId: OTHER, companyId: null, corporateRole: null }, req), true);
});
