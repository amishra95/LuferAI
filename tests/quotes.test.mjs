// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComparisonMatrix, depositFor, priceQuote, quoteVenue } from "../lib/quotes.ts";

const KA_COMPANY = "29AABCN4821K1ZA"; // Karnataka
const DL_COMPANY = "07AAECV6730M1ZX"; // Delhi
const venue = { id: "v1", name: "Copper Courtyard", gstin: "29AADCC1904P1ZF", capacity_max: 80, min_spend_inr: 75000, pdr_available: true };
const pkgs = [
  { id: "p1", name: "Classic", per_head_inr: 2200, dietary_tags: ["vegetarian"], is_active: true },
  { id: "p2", name: "Grill", per_head_inr: 2900, dietary_tags: ["halal"], is_active: true },
  { id: "p3", name: "Retired", per_head_inr: 1000, dietary_tags: ["vegetarian"], is_active: false },
];
const req = { partySize: 40, budgetPerHead: 2500, dietary: [], requiresPdr: false, rateCard: null, companyGstin: KA_COMPANY };
const card = (overrides) => ({
  id: "rc1",
  discount_percentage: 0,
  custom_per_head_rate: null,
  minimum_spend_override: null,
  effective_from: "2026-01-01",
  effective_to: null,
  ...overrides,
});

test("priceQuote invoices the taxable value and reports the adjustment from list", () => {
  const p = priceQuote({ listAmount: 100000, taxableValue: 85000, companyGstin: KA_COMPANY, venueGstin: venue.gstin });
  assert.equal(p.adjustment, -15000);
  assert.equal(p.invoice.taxable_value, 85000);
  assert.equal(p.invoice.gst_type, "CGST_SGST");
  assert.equal(priceQuote({ listAmount: 1, taxableValue: 1, companyGstin: DL_COMPANY, venueGstin: venue.gstin }).invoice.gst_type, "IGST");
});

test("deposit is 25% of the GST-inclusive total, to the paisa", () => {
  assert.equal(depositFor(118000), 29500);
  assert.equal(depositFor(100.03), 25.01);
});

test("quote picks the dearest active package within budget; list pricing without a card", () => {
  const q = quoteVenue(venue, pkgs, req);
  assert.equal(q.status, "quoted");
  assert.equal(q.package_name, "Classic"); // Grill over budget, Retired inactive
  assert.equal(q.rate_card_id, null);
  assert.equal(q.min_spend_applied, false); // 40 × 2,200 = 88,000 > 75,000
  assert.equal(q.price.taxable_value, 88000);
  assert.equal(q.price.adjustment, 0);
});

test("a discount rate card lowers the quote and can trigger the minimum-spend floor", () => {
  const q = quoteVenue(venue, pkgs, { ...req, rateCard: card({ discount_percentage: 15 }) });
  // 2,200 × 0.85 = 1,870/head × 40 = 74,800 < 75,000 minimum → floored
  assert.equal(q.rate_card_id, "rc1");
  assert.equal(q.min_spend_applied, true);
  assert.equal(q.price.taxable_value, 75000);
  assert.equal(q.price.adjustment, 75000 - 88000);
});

test("a fixed per-head rate with a lower minimum-spend override replaces the package price", () => {
  const q = quoteVenue(venue, pkgs, { ...req, rateCard: card({ custom_per_head_rate: 1600, minimum_spend_override: 50000 }) });
  assert.equal(q.price.taxable_value, 64000); // 40 × 1,600, above the ₹50k override
  assert.equal(q.min_spend_applied, false);
});

test("dietary needs and capacity / PDR rule venues out", () => {
  assert.deepEqual(quoteVenue(venue, pkgs, { ...req, dietary: ["vegan"] }), { status: "no_fit", reason: "No package covers Vegan" });
  assert.equal(quoteVenue(venue, pkgs, { ...req, partySize: 81 }).status, "no_fit");
  assert.equal(quoteVenue({ ...venue, pdr_available: false }, pkgs, { ...req, requiresPdr: true }).status, "no_fit");
});

test("over-budget briefs still get the cheapest covering package, flagged", () => {
  const q = quoteVenue(venue, pkgs, { ...req, dietary: ["halal"] });
  assert.equal(q.package_name, "Grill");
  assert.equal(q.over_budget, true);
});

test("matrix puts the cheapest bid first, escapes pipes, and lists non-fits last", () => {
  const price = (list, taxable) => priceQuote({ listAmount: list, taxableValue: taxable, companyGstin: KA_COMPANY, venueGstin: venue.gstin });
  const v = (name) => ({ name, neighborhood: "Indiranagar", capacity_max: 80, pdr_available: true });
  const md = buildComparisonMatrix(
    { party_size: 40, budget_per_head_inr: 2500, dietary_tags: ["vegetarian"], event_date: "2027-01-15", city: "Bengaluru" },
    [
      { venue: v("Pricey"), status: "quoted", package_name: "A", per_head_inr: 3000, price: price(120000, 120000), notes: null },
      { venue: v("No Fit"), status: "no_fit", package_name: null, per_head_inr: null, price: null, notes: "Seats up to 30" },
      { venue: v("Cheap"), status: "countered", package_name: "B|C", per_head_inr: 2000, price: price(80000, 72000), notes: null },
    ]
  );
  const header = md.split("\n").find((l) => l.startsWith("| |"));
  assert.equal(header, "| | **Cheap** | **Pricey** | **No Fit** |");
  assert.match(md, /B\\\|C/);
  assert.match(md, /\| Response \| Venue counter-offer \| Instant quote \| Not a fit \|/);
  assert.match(md, /\| Rate card \/ min spend \| −₹8,000 \| — \| — \|/);
});
