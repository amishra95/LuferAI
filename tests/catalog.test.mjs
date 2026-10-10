import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecipientLines, priceOrder, taxOf, validateAttributes, validateItemInput } from "../lib/catalog/items.ts";
import { canOrderTransition, chooseItems, ORDER_STATUSES, ORDER_TRANSITIONS, orderAllocationStatus, supplierActions, validateTracking } from "../lib/catalog/orders.ts";
import { calculateGst, DEFAULT_TAX } from "../lib/gst-engine.ts";
import { ActionError, dispatch, unwrap } from "../lib/mutations/dispatch.ts";
import { createOptimisticState, errorMessage } from "../lib/mutations/optimistic.ts";
import { poBalance, selectPo, subjectOf } from "../lib/procurement/po-ledger.ts";
import { parseTelemetryEvent, visibleTo } from "../lib/telemetry/events.ts";
import { isStale } from "../lib/telemetry/refresh.ts";

const TODAY = "2026-10-10";
const item = (over = {}) => ({
  id: "i1",
  partner_id: "p1",
  category: "gifting",
  name: "Coffee hamper",
  unit_price_inr: 1800,
  tax_kind: "HSN",
  tax_code: "2106",
  gst_rate_percent: 18,
  min_quantity: 2,
  max_quantity: 100,
  attributes: { lead_time_days: 5 },
  status: "active",
  ...over,
});
const TICKETS = {
  event_name: "T20 League",
  event_date: "2026-11-29",
  venue: "Chinnaswamy",
  event_state_code: "29",
  tiers: [
    { name: "General", price_inr: 1500, available: 200 },
    { name: "Pavilion", price_inr: 4500, available: 3 },
  ],
};
const recipient = (name, size) => ({ name, address: "12 Lavelle Road, Bengaluru 560001", ...(size && { size }) });

// ----------------------------------------------------------------------------
// Attributes and items
// ----------------------------------------------------------------------------

test("attributes: validated and cleaned per category", () => {
  assert.deepEqual(validateAttributes("gifting", { lead_time_days: 5, junk: 1, contains_alcohol: false }), { ok: true, value: { contains_alcohol: false, lead_time_days: 5 } });
  assert.equal(validateAttributes("merch", { sizes: [] }).ok, false);
  assert.deepEqual(validateAttributes("merch", { sizes: ["M", "M", "L"] }).value, { sizes: ["M", "L"] });
  assert.equal(validateAttributes("team_building", { duration_hours: 3, format: "rooftop" }).ok, false);
  assert.equal(validateAttributes("tickets", TICKETS).ok, true);
  assert.match(validateAttributes("tickets", { ...TICKETS, tiers: [{ name: "A", price_inr: 1, available: 1 }, { name: "a", price_inr: 2, available: 1 }] }).error, /must be different/);
  assert.match(validateAttributes("tickets", { ...TICKETS, event_state_code: "KA" }).error, /state code/);
});

test("items: goods need HSN codes, services SAC; rates are GST slabs", () => {
  const base = { category: "merch", ref: "TEE", name: "Team tee", unit_price_inr: 650, tax_kind: "HSN", tax_code: "6109", gst_rate_percent: 5, min_quantity: 10, attributes: { sizes: ["S", "M"] } };
  const ok = validateItemInput(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.max_quantity, null);
  assert.match(validateItemInput({ ...base, tax_kind: "SAC" }).error, /goods: use an HSN code/);
  assert.match(validateItemInput({ ...base, category: "team_building", attributes: { duration_hours: 2, format: "virtual" } }).error, /services: use a SAC code/);
  assert.match(validateItemInput({ ...base, gst_rate_percent: 15 }).error, /0, 5, 12, 18 or 28/);
  assert.match(validateItemInput({ ...base, max_quantity: 5 }).error, /at least the minimum/);
  assert.match(validateItemInput({ ...base, tax_code: "61-09" }).error, /4–8 digits/);
});

// ----------------------------------------------------------------------------
// Pricing orders
// ----------------------------------------------------------------------------

test("gifting: one unit per recipient, lead time enforced", () => {
  const r = priceOrder(item(), { quantity: 99, neededBy: "2026-10-20", recipients: [recipient("Asha Rao"), recipient("Dev Iyer")] }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.value.quantity, 2); // the recipients decide it
  assert.equal(r.value.total, 3600);
  assert.equal(r.value.perHead, 1800);
  assert.deepEqual(r.value.tax, { kind: "HSN", code: "2106", description: "Gifting: Coffee hamper", rate_percent: 18 });
  assert.match(priceOrder(item(), { quantity: 2, neededBy: "2026-10-12", recipients: [recipient("A b"), recipient("C d")] }, TODAY).error, /5 days' notice: the earliest is 2026-10-15/);
  assert.match(priceOrder(item(), { quantity: 1, neededBy: "2026-10-20", recipients: [recipient("Asha Rao")] }, TODAY).error, /at least 2 gifts/);
  assert.match(priceOrder(item(), { quantity: 2, neededBy: "2026-10-20", recipients: [{ name: "X y", address: "short" }, recipient("A b")] }, TODAY).error, /Recipient 1: enter a full delivery address/);
  assert.match(priceOrder(item({ status: "paused" }), { quantity: 2 }, TODAY).error, /isn't available/);
});

test("merch: every recipient needs a listed size; sizes are tallied", () => {
  const tee = item({ category: "merch", min_quantity: 1, attributes: { sizes: ["S", "M", "L"], lead_time_days: 10 } });
  const r = priceOrder(tee, { quantity: 0, neededBy: "2026-11-01", recipients: [recipient("Asha Rao", "M"), recipient("Dev Iyer", "M"), recipient("Ravi K", "L")] }, TODAY);
  assert.deepEqual(r.value.selections, { sizes: { M: 2, L: 1 } });
  assert.match(priceOrder(tee, { quantity: 0, neededBy: "2026-11-01", recipients: [recipient("Asha Rao", "XXL")] }, TODAY).error, /choose a size \(S, M, L\)/);
});

test("tickets: the tier sets the price; seats and the event's state are respected", () => {
  const t = item({ category: "tickets", tax_kind: "SAC", tax_code: "999692", min_quantity: 2, max_quantity: 50, attributes: TICKETS });
  const r = priceOrder(t, { quantity: 4, tier: "General" }, TODAY);
  assert.equal(r.value.unitPrice, 1500);
  assert.equal(r.value.total, 6000);
  assert.equal(r.value.eventDate, "2026-11-29");
  assert.equal(r.value.placeOfSupplyState, "29");
  assert.deepEqual(r.value.selections, { tier: "General" });
  assert.match(priceOrder(t, { quantity: 4, tier: "Pavilion" }, TODAY).error, /Only 3 Pavilion tickets are left/);
  assert.match(priceOrder(t, { quantity: 4, tier: "VIP" }, TODAY).error, /Choose a ticket tier \(General, Pavilion\)/);
});

test("team building: headcount within the item's limits", () => {
  const hunt = item({ category: "team_building", tax_kind: "SAC", tax_code: "998596", unit_price_inr: 1500, min_quantity: 15, max_quantity: 120, attributes: { duration_hours: 3, format: "offsite", lead_time_days: 7 } });
  assert.equal(priceOrder(hunt, { quantity: 40, eventDate: "2026-10-30" }, TODAY).value.total, 60000);
  assert.match(priceOrder(hunt, { quantity: 10, eventDate: "2026-10-30" }, TODAY).error, /at least 15 participants/);
  assert.match(priceOrder(hunt, { quantity: 200, eventDate: "2026-10-30" }, TODAY).error, /at most 120 participants/);
  assert.match(priceOrder(hunt, { quantity: 40, eventDate: "2026-10-12" }, TODAY).error, /7 days' notice/);
});

// ----------------------------------------------------------------------------
// GST per item
// ----------------------------------------------------------------------------

const KA_BUYER = "29AABCN4821K1ZA";
test("GST: the item's rate splits into CGST/SGST intra-state, IGST inter-state", () => {
  const tee = calculateGst({ total_amount: 6500, company_gstin: KA_BUYER, venue_gstin: "29AAGCG4512K1ZG", tax: taxOf(item({ category: "merch", name: "Tee", tax_code: "6109", gst_rate_percent: 5 })) });
  assert.equal(tee.gst_type, "CGST_SGST");
  assert.deepEqual([tee.tax_breakup.cgst.rate_percent, tee.tax_breakup.cgst.amount, tee.tax_breakup.sgst.amount], [2.5, 162.5, 162.5]);
  assert.equal(tee.invoice_total, 6825);
  assert.equal(tee.sac.code, "6109");
  const fromTN = calculateGst({ total_amount: 6500, company_gstin: KA_BUYER, venue_gstin: "33AAKCT6620P1ZV", tax: taxOf(item({ gst_rate_percent: 5 })) });
  assert.equal(fromTN.gst_type, "IGST");
  assert.equal(fromTN.tax_breakup.igst.amount, 325);
});

test("GST: event admission is supplied where the event is held", () => {
  const tax = { kind: "SAC", code: "999692", description: "Tickets", rate_percent: 18 };
  // A Maharashtra ticketing company selling a Bengaluru match: supplied in Karnataka from Maharashtra, so IGST.
  const r = calculateGst({ total_amount: 6000, company_gstin: KA_BUYER, venue_gstin: "27AAJCT7781M1ZF", tax, place_of_supply_state_code: "29" });
  assert.equal(r.place_of_supply.state_code, "29");
  assert.equal(r.gst_type, "IGST");
  // A Karnataka buyer, Karnataka supplier, event in Maharashtra: inter-state too.
  const away = calculateGst({ total_amount: 6000, company_gstin: KA_BUYER, venue_gstin: "29AAFCT3390Q1ZI", tax, place_of_supply_state_code: "27" });
  assert.equal(away.gst_type, "IGST");
  // An unknown state code falls back to the recipient's state.
  assert.equal(calculateGst({ total_amount: 1, company_gstin: KA_BUYER, venue_gstin: "29AAFCT3390Q1ZI", tax, place_of_supply_state_code: "99" }).place_of_supply.state_code, "29");
});

test("GST: venue bookings are unchanged (SAC 998596 at 18%)", () => {
  const r = calculateGst({ total_amount: 100000, company_gstin: KA_BUYER, venue_gstin: "29AADCC1904P1ZF" });
  assert.deepEqual(r.tax, DEFAULT_TAX);
  assert.deepEqual([r.sac.code, r.tax_breakup.cgst.rate_percent, r.total_tax], ["998596", 9, 18000]);
  assert.throws(() => calculateGst({ total_amount: 1, company_gstin: KA_BUYER, venue_gstin: "29AADCC1904P1ZF", tax: { ...DEFAULT_TAX, rate_percent: 15 } }), /GST rate/);
});

// ----------------------------------------------------------------------------
// Order lifecycle and fulfilment
// ----------------------------------------------------------------------------

test("order lifecycle: goods ship, services go straight to delivered", () => {
  assert.deepEqual(Object.keys(ORDER_TRANSITIONS).sort(), [...ORDER_STATUSES].sort());
  assert.equal(canOrderTransition("CONFIRMED", "SHIPPED"), true);
  assert.equal(canOrderTransition("SHIPPED", "CANCELLED"), false); // in transit
  assert.equal(canOrderTransition("DELIVERED", "SETTLED"), true);
  assert.equal(canOrderTransition("PENDING_APPROVAL", "CONFIRMED"), false); // the supplier must see it first
  assert.deepEqual(supplierActions("gifting", "CONFIRMED"), ["SHIPPED", "CANCELLED"]);
  assert.deepEqual(supplierActions("tickets", "CONFIRMED"), ["DELIVERED", "CANCELLED"]);
  assert.deepEqual(supplierActions("merch", "PENDING_APPROVAL"), []);
  assert.deepEqual(["PLACED", "SHIPPED", "DELIVERED", "SETTLED", "CANCELLED"].map(orderAllocationStatus), ["committed", "committed", "consumed", "consumed", "released"]);
});

test("tracking: carrier and reference required, link must be https", () => {
  assert.deepEqual(validateTracking({ carrier: " Blue Dart ", reference: "BD12345678" }), { ok: true, value: { carrier: "Blue Dart", reference: "BD12345678" } });
  assert.match(validateTracking({ carrier: "Blue Dart", reference: "x" }).error, /tracking number/);
  assert.match(validateTracking({ carrier: "Blue Dart", reference: "BD12345678", url: "http://track.example" }).error, /https/);
});

test("recipient lines: name | address | size", () => {
  assert.deepEqual(parseRecipientLines("Asha Rao | 12 Lavelle Rd | M\n\n  Dev | 4 MG Road  "), [
    { name: "Asha Rao", address: "12 Lavelle Rd", size: "M" },
    { name: "Dev", address: "4 MG Road" },
  ]);
});

// ----------------------------------------------------------------------------
// The agent's item choice
// ----------------------------------------------------------------------------

test("agent: best item within budget, then cheapest above it, never past the ceiling", () => {
  const items = [
    item({ id: "cheap", unit_price_inr: 900, min_quantity: 1 }),
    item({ id: "best", unit_price_inr: 1400, min_quantity: 1 }),
    item({ id: "over", unit_price_inr: 1700, min_quantity: 1 }),
    item({ id: "far", unit_price_inr: 2500, min_quantity: 1 }),
    item({ id: "wine", unit_price_inr: 1200, min_quantity: 1, attributes: { contains_alcohol: true } }),
    item({ id: "slow", unit_price_inr: 1000, min_quantity: 1, attributes: { lead_time_days: 30 } }),
    item({ id: "bulk", unit_price_inr: 1000, min_quantity: 50 }),
  ];
  const req = { category: "gifting", quantity: 20, perHead: 1500, maxPerHead: 2000, date: "2026-10-25", today: TODAY, noAlcohol: true };
  const { choices, excluded } = chooseItems(items, req);
  assert.deepEqual(choices.map((c) => c.item.id), ["best", "cheap", "over"]);
  assert.deepEqual(Object.fromEntries(excluded.map((e) => [e.item.id, e.reason])), {
    far: "₹2500 each is over the ₹2000 ceiling",
    wine: "contains alcohol",
    slow: "needs 30 days' notice",
    bulk: "needs at least 50",
  });
});

test("agent: tickets match the date and the cheapest tier with seats", () => {
  const t = item({ category: "tickets", min_quantity: 1, max_quantity: 50, attributes: TICKETS });
  const req = { category: "tickets", quantity: 10, perHead: 2000, maxPerHead: 5000, date: "2026-11-29", today: TODAY, noAlcohol: false };
  const [choice] = chooseItems([t], req).choices;
  assert.deepEqual([choice.unitPrice, choice.tier], [1500, "General"]);
  assert.equal(chooseItems([t], { ...req, date: "2026-11-30" }).excluded[0].reason, "is on 2026-11-29");
});

// ----------------------------------------------------------------------------
// PO ledger with orders; events; rollback
// ----------------------------------------------------------------------------

test("PO balances count order allocations; re-allocation excludes the subject itself", () => {
  const allocations = [
    { id: "a", po_id: "po", booking_id: "b1", catalog_order_id: null, amount_inr: 30000, status: "committed", over_balance: false },
    { id: "b", po_id: "po", booking_id: null, catalog_order_id: "o1", amount_inr: 20000, status: "consumed", over_balance: false },
  ];
  assert.equal(subjectOf(allocations[1]), "o1");
  assert.equal(poBalance({ id: "po", amount_inr: 100000 }, allocations).remaining, 50000);
  assert.equal(poBalance({ id: "po", amount_inr: 100000 }, allocations, "o1").remaining, 70000);
  const po = { id: "po", tenant_id: "t", po_number: "P", department_id: null, amount_inr: 100000, valid_from: "2026-04-01", valid_to: "2027-03-31", status: "open" };
  assert.equal(selectPo([po], allocations, { tenantId: "t", eventDate: "2026-11-01", departmentId: null, amount: 60000, subjectId: "o1" }).kind, "ok");
});

test("order events: parsed, operator-only, refresh client, partner and admin", () => {
  const e = { seq: 9, at: 9, type: "order", orderId: "o1", partnerId: "p1", status: "SHIPPED", by: "supplier" };
  assert.deepEqual(parseTelemetryEvent(JSON.stringify(e)), e);
  assert.equal(parseTelemetryEvent(JSON.stringify({ ...e, by: "robot" })), null);
  assert.equal(visibleTo(e, { ops: false, venues: true }), false);
  assert.deepEqual(["/client", "/partner", "/admin", "/venues"].map((p) => isStale(p, [e])), [true, true, true, false]);
});

test("placing an order: the 'placing…' row disappears with the reason when refused", async () => {
  const orders = createOptimisticState([{ id: "old", status: "PLACED" }]);
  const out = await orders.mutate({
    apply: (l) => [{ id: "tmp", status: "PLACED", pending: true }, ...l],
    run: async () => unwrap(await dispatch("client/placeCatalogOrder", () => { throw new ActionError("Giftwise Hampers hasn't added a GSTIN yet, so it can't invoice."); })),
  });
  assert.deepEqual(orders.view(), [{ id: "old", status: "PLACED" }]);
  assert.match(errorMessage(out.error), /GSTIN/);
});
