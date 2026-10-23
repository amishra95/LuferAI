// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// A venue's book of business (lib/venues/accounts.ts): accounts from its
// bookings, their status, and the suggested next step with each client.
import { test } from "node:test";
import assert from "node:assert/strict";

import { accountOpportunities, bookSummary, LAPSED_DAYS, REBOOK_LEAD_DAYS, UPSELL_WINDOW_DAYS, venueAccounts } from "../lib/venues/accounts.ts";

const TODAY = "2026-10-23";
let n = 0;
const booking = (company, event_date, { status = "COMPLETED", party = 40, perHead = 2000 } = {}) => ({
  id: `b${++n}`,
  status,
  event_date,
  party_size: party,
  budget_per_head_inr: perHead,
  total_amount_inr: party * perHead,
  company: { id: company, legal_name: `${company} Private Limited` },
});

test("accounts: booked value, share, events and averages per client, largest first", () => {
  const accounts = venueAccounts(
    [booking("nimbus", "2026-06-10"), booking("nimbus", "2026-09-10", { party: 60, perHead: 2500 }), booking("vertex", "2026-08-01", { party: 20 }), booking("nimbus", "2026-11-05", { status: "CONFIRMED", party: 50 })],
    TODAY
  );
  assert.deepEqual(accounts.map((a) => a.companyId), ["nimbus", "vertex"]);
  const [nimbus, vertex] = accounts;
  assert.equal(nimbus.bookedValue, 80000 + 150000 + 100000);
  assert.equal(nimbus.events, 3);
  assert.equal(nimbus.pastEvents, 2);
  assert.deepEqual([nimbus.lastEvent, nimbus.nextEvent, nimbus.nextEventParty], ["2026-09-10", "2026-11-05", 50]);
  assert.equal(nimbus.avgParty, 50);
  assert.equal(nimbus.avgPerHead, 2167);
  assert.equal(Math.round((nimbus.share + vertex.share) * 100), 100);
  assert.equal(nimbus.companyName, "nimbus Private Limited");
});

test("cancelled and unconfirmed bookings don't count", () => {
  const accounts = venueAccounts([booking("nimbus", "2026-09-01", { status: "CANCELLED" }), booking("nimbus", "2026-11-01", { status: "PENDING" }), booking("vertex", "2026-09-01")], TODAY);
  assert.deepEqual(accounts.map((a) => a.companyId), ["vertex"]);
});

test("cadence: the median gap between events; due when the next would be within the lead window", () => {
  // Every ~90 days; last on 2026-08-01, so due ~2026-10-30: within 21 days of today.
  const [a] = venueAccounts([booking("c", "2026-02-02"), booking("c", "2026-05-03"), booking("c", "2026-08-01")], TODAY);
  assert.equal(a.cadenceDays, 90);
  assert.equal(a.dueOn, "2026-10-30");
  assert.equal(a.status, "due");
  assert.equal(REBOOK_LEAD_DAYS, 21);
  // Not yet: a 180-day rhythm last seen in August.
  const [b] = venueAccounts([booking("c", "2026-02-02"), booking("c", "2026-08-01")], TODAY);
  assert.equal(b.status, "active");
});

test("status: lapsed after four months quiet; new with one event; anything upcoming keeps them active", () => {
  assert.equal(LAPSED_DAYS, 120);
  assert.equal(venueAccounts([booking("c", "2026-03-01"), booking("c", "2026-05-01")], TODAY)[0].status, "lapsed");
  assert.equal(venueAccounts([booking("c", "2026-09-30")], TODAY)[0].status, "new");
  assert.equal(venueAccounts([booking("c", "2026-11-30", { status: "CONFIRMED" })], TODAY)[0].status, "new");
  assert.equal(venueAccounts([booking("c", "2026-03-01"), booking("c", "2026-12-01", { status: "CONFIRMED" })], TODAY)[0].status, "active");
});

test("next steps: one per client, most time-sensitive first", () => {
  const accounts = venueAccounts(
    [
      // Due to rebook.
      booking("due", "2026-02-02"),
      booking("due", "2026-05-03"),
      booking("due", "2026-08-01"),
      // Event in 2 weeks.
      booking("soon", "2026-04-01"),
      booking("soon", "2026-11-06", { status: "CONFIRMED", party: 80 }),
      // Lapsed, and the biggest spender.
      booking("gone", "2026-01-10", { party: 200, perHead: 3000 }),
      booking("gone", "2026-03-10", { party: 200, perHead: 3000 }),
      // One event, a month ago.
      booking("once", "2026-09-20", { party: 25 }),
    ],
    TODAY
  );
  const steps = accountOpportunities(accounts, TODAY);
  assert.deepEqual(
    steps.map((s) => [s.companyId, s.kind]),
    [
      ["due", "rebook"],
      ["soon", "upcoming_upsell"],
      ["gone", "win_back"],
      ["once", "first_repeat"],
    ]
  );
  assert.equal(steps[0].title, "Due to rebook around 30 Oct");
  assert.match(steps[0].detail, /They book about every 90 days; the last event was 1 Aug\./);
  assert.equal(steps[1].title, "Upcoming on 6 Nov for 80");
  assert.match(steps[2].detail, /^7 months without a booking \(2 before, ₹12,00,000\)/);
  assert.equal(UPSELL_WINDOW_DAYS, 45);
});

test("an upcoming event further out than the upsell window gets no nudge", () => {
  const accounts = venueAccounts([booking("c", "2026-04-01"), booking("c", "2027-02-01", { status: "CONFIRMED" })], TODAY);
  assert.deepEqual(accountOpportunities(accounts, TODAY), []);
});

test("low spenders get a premium suggestion, once there are enough clients to know what's typical", () => {
  // Seven months apart and seen last month: neither due to rebook nor lapsed.
  const recent = (c, perHead) => [booking(c, "2026-03-01", { perHead }), booking(c, "2026-09-30", { perHead })];
  const accounts = venueAccounts([...recent("a", 3000), ...recent("b", 3000), ...recent("c", 3000), ...recent("cheap", 1500)], TODAY);
  const steps = accountOpportunities(accounts, TODAY);
  assert.deepEqual(steps.map((s) => [s.companyId, s.kind]), [["cheap", "premium"]]);
  assert.match(steps[0].detail, /Below your typical ₹3,000/);
  // With only two clients there's no "typical" yet.
  assert.deepEqual(accountOpportunities(venueAccounts([...recent("a", 3000), ...recent("cheap", 1500)], TODAY), TODAY), []);
});

test("summary: clients, repeat rate and concentration", () => {
  const accounts = venueAccounts([booking("big", "2026-09-01", { party: 100 }), booking("big", "2026-10-01", { party: 100 }), booking("small", "2026-09-15", { party: 10 })], TODAY);
  const s = bookSummary(accounts);
  assert.deepEqual([s.clients, s.repeatRate, s.bookedValue], [2, 0.5, 420000]);
  assert.equal(Math.round(s.topShare * 100), 95);
  assert.deepEqual(bookSummary([]), { clients: 0, repeatRate: 0, topShare: 0, bookedValue: 0 });
});
