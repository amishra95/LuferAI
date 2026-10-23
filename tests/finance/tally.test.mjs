// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Tally Prime XML export: the voucher builder (lib/finance/tally-xml.ts), which
// routes GST by the booking's ITC status and always balances, and the download
// route (app/api/finance/tally-export) on the in-memory store.
import { signIn } from "../support/server-actions.mjs";
import { after, test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_TALLY_LEDGERS, tallyEntries, tallyEnvelope, tallyVoucher, xmlEscape } from "../../lib/finance/tally-xml.ts";
import { buildExpenseReceipt } from "../../lib/finance/receipt.ts";
import { booking, OTHER_CO, receipt, VENUE_MH } from "./fixtures.mjs";

const { GET } = await import("../../app/api/finance/tally-export/route.ts");
const { mutateDb } = await import("../../lib/data/local-store.ts");

after(() => signIn(null));

const L = DEFAULT_TALLY_LEDGERS;
const sum = (entries) => entries.reduce((s, e) => s + e.amountPaise, 0);
const byLedger = (entries) => Object.fromEntries(entries.map((e) => [e.ledger, e.amountPaise]));

/** A minimal well-formedness check: every tag closes, in order, and nothing is left open. */
function assertWellFormed(xml) {
  const stack = [];
  for (const [, close, name, selfClosing] of xml.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z][\w.:]*)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (close) assert.equal(stack.pop(), name, `unexpected </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], "unclosed tags");
  assert.doesNotMatch(xml.replace(/&(amp|lt|gt|quot|apos);/g, ""), /&/, "unescaped &");
}

// ---------------------------------------------------------------------------
// Ledger lines
// ---------------------------------------------------------------------------

test("ITC eligible within the state: party credited the total, expense and CGST + SGST debited, balanced", () => {
  const entries = tallyEntries(receipt({ itc_decision: "eligible" }));
  assert.equal(sum(entries), 0);
  assert.deepEqual(entries[0], { ledger: "The Copper Courtyard", amountPaise: 11_800_000, isParty: true, billRef: "LUF-BBBBBBBB" });
  assert.deepEqual(entries[1], { ledger: L.expense, amountPaise: -10_000_000, costCentre: "ENG-BLR" });
  assert.deepEqual(byLedger(entries.slice(2)), { [L.cgst]: -900_000, [L.sgst]: -900_000 });
});

test("ITC eligible across states: IGST only", () => {
  const entries = tallyEntries(receipt({ itc_decision: "eligible", venueGstin: VENUE_MH }));
  assert.equal(sum(entries), 0);
  assert.deepEqual(byLedger(entries.slice(1)), { [L.expense]: -10_000_000, [L.igst]: -1_800_000 });
});

test("ITC blocked: the GST is part of the expense, no input tax is booked", () => {
  const entries = tallyEntries(receipt({ itc_decision: "blocked" }));
  assert.equal(sum(entries), 0);
  assert.deepEqual(byLedger(entries.slice(1)), { [L.expense]: -11_800_000 });
});

test("not eligible (billed to another legal entity): the GST is cost too", () => {
  const entries = tallyEntries(receipt({ billing: OTHER_CO, itc_decision: "eligible" }));
  assert.deepEqual(byLedger(entries.slice(1)), { [L.expense]: -11_800_000 });
});

test("not yet decided: the GST waits on the ITC-pending ledger, whether invoiced or not", () => {
  for (const status of ["COMPLETED", "CONFIRMED"]) {
    const entries = tallyEntries(receipt({ status }));
    assert.equal(sum(entries), 0, status);
    assert.deepEqual(byLedger(entries.slice(1)), { [L.expense]: -10_000_000, [L.itcPending]: -1_800_000 }, status);
  }
});

test("ledger names come from the options", () => {
  const ledgers = { expense: "Staff Welfare", cgst: "CGST Input @9%", sgst: "SGST Input @9%", igst: "IGST Input @18%", itcPending: "GST Suspense", roundOff: "Rounding" };
  const entries = tallyEntries(receipt({ itc_decision: "eligible" }), { ledgers });
  assert.deepEqual(entries.slice(1).map((e) => e.ledger), ["Staff Welfare", "CGST Input @9%", "SGST Input @9%"]);
});

test("a receipt that doesn't add up gets a round-off line, so the voucher still balances", () => {
  const r = receipt({ itc_decision: "eligible" });
  r.tax.invoice_total += 0.4;
  const entries = tallyEntries(r);
  assert.equal(sum(entries), 0);
  assert.deepEqual(entries.at(-1), { ledger: L.roundOff, amountPaise: -40 });
});

test("no cost centre: no cost allocation", () => {
  const r = buildExpenseReceipt({ ...booking({ itc_decision: "eligible" }), cost_center: null }, "2026-11-07T10:00:00.000Z");
  assert.equal(tallyEntries(r)[1].costCentre, undefined);
  assert.doesNotMatch(tallyVoucher(r), /CATEGORYALLOCATIONS/);
});

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

test("a voucher has Tally's header fields: type, date, reference, party, GSTINs and place of supply", () => {
  const xml = tallyVoucher(receipt({ itc_decision: "eligible" }));
  assert.match(xml, /<VOUCHER REMOTEID="lufer:booking\.confirmed:bbbbbbbb-0001-4000-8000-000000000001" VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View">/);
  for (const t of [
    "<DATE>20261106</DATE>",
    "<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>",
    "<REFERENCE>LUF-BBBBBBBB</REFERENCE>",
    "<PARTYLEDGERNAME>The Copper Courtyard</PARTYLEDGERNAME>",
    `<PARTYGSTIN>${receipt().supplier.gstin}</PARTYGSTIN>`,
    "<CMPGSTIN>29AABCN4821K1ZA</CMPGSTIN>",
    "<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>",
  ]) {
    assert.ok(xml.includes(t), t);
  }
  assert.match(xml, /<NARRATION>Corporate event at The Copper Courtyard, Bengaluru · 2026-11-06, 40 guests · SAC 998596 · ITC: eligible · Project Q4-OFFSITE · Lufer\.ai LUF-BBBBBBBB<\/NARRATION>/);
});

test("debits are negative with ISDEEMEDPOSITIVE Yes; the party credit is bill-wise and the expense carries its cost centre", () => {
  const xml = tallyVoucher(receipt({ itc_decision: "eligible" }));
  const lines = [...xml.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)].map((m) => m[1]);
  assert.equal(lines.length, 4);
  for (const l of lines) {
    const negative = /<AMOUNT>-/.test(l);
    assert.match(l, new RegExp(`<ISDEEMEDPOSITIVE>${negative ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`));
  }
  assert.match(lines[0], /<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>[\s\S]*<BILLALLOCATIONS\.LIST>\s*<NAME>LUF-BBBBBBBB<\/NAME>\s*<BILLTYPE>New Ref<\/BILLTYPE>\s*<AMOUNT>118000\.00<\/AMOUNT>/);
  assert.match(lines[1], /<CATEGORY>Primary Cost Category<\/CATEGORY>[\s\S]*<COSTCENTREALLOCATIONS\.LIST>\s*<NAME>ENG-BLR<\/NAME>\s*<AMOUNT>-100000\.00<\/AMOUNT>/);
  assert.match(lines[2], /<LEDGERNAME>Input CGST<\/LEDGERNAME>[\s\S]*<AMOUNT>-9000\.00<\/AMOUNT>/);
});

test("Journal vouchers and a custom cost category", () => {
  const xml = tallyVoucher(receipt({ itc_decision: "eligible" }), { voucherType: "Journal", costCategory: "Departments" });
  assert.match(xml, /VCHTYPE="Journal"/);
  assert.match(xml, /<VOUCHERTYPENAME>Journal<\/VOUCHERTYPENAME>/);
  assert.match(xml, /<CATEGORY>Departments<\/CATEGORY>/);
});

test("the envelope: Import Data of Vouchers, one TALLYMESSAGE per voucher, the company only when named", () => {
  const xml = tallyEnvelope([receipt({ itc_decision: "eligible" }), receipt({ itc_decision: "blocked", venueGstin: VENUE_MH })], { companyName: "Nimbus Analytics Pvt Ltd" });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<ENVELOPE>/);
  assert.match(xml, /<TALLYREQUEST>Import Data<\/TALLYREQUEST>/);
  assert.match(xml, /<REPORTNAME>Vouchers<\/REPORTNAME>/);
  assert.match(xml, /<SVCURRENTCOMPANY>Nimbus Analytics Pvt Ltd<\/SVCURRENTCOMPANY>/);
  assert.equal(xml.match(/<TALLYMESSAGE xmlns:UDF="TallyUDF">/g).length, 2);
  assertWellFormed(xml);
  assert.doesNotMatch(tallyEnvelope([]), /STATICVARIABLES/);
  assertWellFormed(tallyEnvelope([]));
});

test("names with XML characters are escaped and control characters dropped", () => {
  assert.equal(xmlEscape(`Café & Bar <Rooftop> "Chef's"\u0007`), "Café &amp; Bar &lt;Rooftop&gt; &quot;Chef&apos;s&quot;");
  const r = buildExpenseReceipt({ ...booking({ itc_decision: "eligible" }), venue: { ...booking().venue, name: "Mosaic Kitchen & Bar <Rooftop>" }, cost_center: "R&D" }, "2026-11-07T10:00:00.000Z");
  const xml = tallyEnvelope([r], { ledgers: { expense: "Events & Offsites" } });
  assertWellFormed(xml);
  assert.match(xml, /<PARTYLEDGERNAME>Mosaic Kitchen &amp; Bar &lt;Rooftop&gt;<\/PARTYLEDGERNAME>/);
  assert.match(xml, /<NAME>R&amp;D<\/NAME>/);
  assert.match(xml, /<LEDGERNAME>Events &amp; Offsites<\/LEDGERNAME>/);
});

// ---------------------------------------------------------------------------
// The download route
// ---------------------------------------------------------------------------

// Seed data (lib/data/mock-store.ts).
const NIMBUS = "11111111-1111-4111-8111-111111111111";
const VERTEX = "22222222-2222-4222-8222-222222222222";
const CONFIRMED = "bbbbbbbb-0001-4000-8000-000000000001"; // Nimbus, 2026-10-16
const COMPLETED = "bbbbbbbb-0002-4000-8000-000000000002"; // Vertex, IGST
const PENDING = "bbbbbbbb-0003-4000-8000-000000000003"; // Nimbus, not confirmed
const asClient = (corporateRole, companyId = NIMBUS) => signIn({ role: "CLIENT", userId: "dddddddd-0002-4000-8000-000000000002", companyId, corporateRole });
const get = (query = "") => GET(new Request(`https://lufer.test/api/finance/tally-export${query}`));

test("route: signed out 401, organizers 403, admins must name the company", async () => {
  signIn(null);
  assert.equal((await get()).status, 401);
  asClient("ORGANIZER");
  assert.equal((await get()).status, 403);
  signIn({ role: "ADMIN", userId: "00000000-0000-4000-8000-000000000000", companyId: null });
  assert.equal((await get()).status, 400);
});

test("route: a finance viewer downloads their company's confirmed bookings as Tally XML", async () => {
  asClient("FINANCE_VIEWER");
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="tally-vouchers-all_\d{4}-\d{2}-\d{2}\.xml"$/);
  assert.equal(res.headers.get("x-lufer-voucher-count"), "1");
  const xml = await res.text();
  assertWellFormed(xml);
  assert.ok(xml.includes(`REMOTEID="lufer:booking.confirmed:${CONFIRMED}"`));
  // Not confirmed yet, and another company's: left out.
  assert.ok(!xml.includes(PENDING) && !xml.includes(COMPLETED));
  // Confirmed but not invoiced: GST waits on the pending ledger.
  assert.match(xml, /<LEDGERNAME>GST ITC Pending Review<\/LEDGERNAME>/);
});

test("route: date range, single booking, voucher type and ledger names", async () => {
  asClient("APPROVER");
  assert.equal((await get("?from=2026-10-17")).headers.get("x-lufer-voucher-count"), "0");
  assert.equal((await get("?from=2026-10-01&to=2026-10-31")).headers.get("x-lufer-voucher-count"), "1");
  const res = await get(`?bookingId=${CONFIRMED}&voucherType=journal&company=Nimbus%20Books&expenseLedger=Staff%20Welfare&costCategory=Teams`);
  assert.match(res.headers.get("content-disposition"), /tally-vouchers-bbbbbbbb\.xml/);
  const xml = await res.text();
  for (const t of ['VCHTYPE="Journal"', "<SVCURRENTCOMPANY>Nimbus Books</SVCURRENTCOMPANY>", "<LEDGERNAME>Staff Welfare</LEDGERNAME>", "<CATEGORY>Teams</CATEGORY>"]) assert.ok(xml.includes(t), t);
});

test("route: another company's or an unconfirmed booking is 404; bad queries are 400", async () => {
  asClient("APPROVER");
  assert.equal((await get(`?bookingId=${COMPLETED}`)).status, 404);
  assert.equal((await get(`?bookingId=${PENDING}`)).status, 404);
  assert.equal((await get("?from=2026-12-01&to=2026-11-01")).status, 400);
  assert.equal((await get("?voucherType=receipt")).status, 400);
  assert.equal((await get("?from=16-10-2026")).status, 400);
});

test("route: an admin exports another company: its inter-state booking, once ITC is eligible, posts Input IGST", async () => {
  const setDecision = (d) =>
    mutateDb((db) => {
      db.bookings.find((b) => b.id === COMPLETED).itc_decision = d;
    });
  await setDecision("eligible");
  try {
    signIn({ role: "ADMIN", userId: "00000000-0000-4000-8000-000000000000", companyId: null });
    const xml = await (await get(`?companyId=${VERTEX}`)).text();
    assert.ok(xml.includes(COMPLETED));
    assert.match(xml, /<PLACEOFSUPPLY>Delhi<\/PLACEOFSUPPLY>/);
    assert.match(xml, /<LEDGERNAME>Input IGST<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<ISPARTYLEDGER>No<\/ISPARTYLEDGER>\s*<AMOUNT>-21600\.00<\/AMOUNT>/);
    assert.doesNotMatch(xml, /Input CGST|Input SGST|GST ITC Pending Review/);
  } finally {
    await setDecision(null);
  }
});
