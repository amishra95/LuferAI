// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConciergeFilters, conciergeFilterQuery, parseConciergeFilters, toConciergeCards } from "../lib/venues/concierge-cards.ts";
import { listingSchema } from "../lib/partner/validation.ts";

const listing = (n, over = {}) => ({
  id: `extranet:id-${n}`,
  tier: "partner",
  name: `Venue ${n}`,
  neighborhood: "MG Road",
  city: "Bengaluru",
  address: "",
  capacity_max: 100,
  min_spend_inr: 0,
  pdr_available: false,
  gstin: null,
  commission_rate: null,
  supplier: "Lufer Concierge",
  bookable: false,
  photo_url: null,
  ...over,
});

const defaults = { city: "Bengaluru", guests: "", space: "", inPolicy: false, sort: "recommended" };

test("only Lufer-kept partner listings become cards, with the extranet prefix dropped", () => {
  const cards = toConciergeCards([listing(1), { ...listing(2), id: "feed-2" }, { ...listing(3), tier: "internal", id: "v3" }]);
  assert.deepEqual(cards.map((c) => c.id), ["id-1"]);
});

test("no price or no rules: no policy badge; priced venues get the company's policy fit", () => {
  const rules = { max_budget_per_head: 2500 };
  const [unpriced, cheap, dear] = toConciergeCards(
    [listing(1), listing(2, { from_per_head_inr: 2000 }), listing(3, { from_per_head_inr: 4000 })],
    rules
  );
  assert.equal(unpriced.policy, null);
  assert.equal(cheap.policy.status, "in_policy");
  assert.notEqual(dear.policy.status, "in_policy");
  assert.equal(toConciergeCards([listing(2, { from_per_head_inr: 2000 })], null)[0].policy, null);
});

test("photos: every photo when listed, else the cover, else none", () => {
  assert.deepEqual(toConciergeCards([listing(1, { photo_urls: ["a", "b"], photo_url: "a" })])[0].photos, ["a", "b"]);
  assert.deepEqual(toConciergeCards([listing(1, { photo_url: "a" })])[0].photos, ["a"]);
  assert.deepEqual(toConciergeCards([listing(1)])[0].photos, []);
});

test("guest bands: under 50, 50–300 inclusive, over 300", () => {
  const cards = toConciergeCards([30, 50, 300, 301].map((c, i) => listing(i, { capacity_max: c })));
  const caps = (guests) => applyConciergeFilters(cards, { ...defaults, guests }).map((c) => c.capacity);
  assert.deepEqual(caps("lt50"), [30]);
  assert.deepEqual(caps("50-300"), [50, 300]);
  assert.deepEqual(caps("300+"), [301]);
  assert.deepEqual(caps(""), [30, 50, 300, 301]);
});

test("space: private room, banquet = hotels, fine dining", () => {
  const cards = toConciergeCards([
    listing(1, { pdr_available: true, category: "bar" }),
    listing(2, { category: "hotel" }),
    listing(3, { category: "fine_dining" }),
  ]);
  const names = (space) => applyConciergeFilters(cards, { ...defaults, space }).map((c) => c.name);
  assert.deepEqual(names("private"), ["Venue 1"]);
  assert.deepEqual(names("banquet"), ["Venue 2"]);
  assert.deepEqual(names("fine"), ["Venue 3"]);
});

test("in policy only drops unpriced and out-of-policy venues; recommended puts in-policy first", () => {
  const cards = toConciergeCards([listing(1), listing(2, { from_per_head_inr: 4000 }), listing(3, { from_per_head_inr: 2000 })], { max_budget_per_head: 2500 });
  assert.deepEqual(applyConciergeFilters(cards, { ...defaults, inPolicy: true }).map((c) => c.name), ["Venue 3"]);
  assert.equal(applyConciergeFilters(cards, defaults)[0].name, "Venue 3");
});

test("sorts: most guests, lowest price with unpriced last, stable ties", () => {
  const cards = toConciergeCards([
    listing(1, { capacity_max: 30 }),
    listing(2, { capacity_max: 400, from_per_head_inr: 3000 }),
    listing(3, { capacity_max: 400, from_per_head_inr: 1500 }),
  ]);
  assert.deepEqual(applyConciergeFilters(cards, { ...defaults, sort: "capacity" }).map((c) => c.name), ["Venue 2", "Venue 3", "Venue 1"]);
  assert.deepEqual(applyConciergeFilters(cards, { ...defaults, sort: "price" }).map((c) => c.name), ["Venue 3", "Venue 2", "Venue 1"]);
});

test("URL round trip: defaults stay out of the URL, unknown values fall back", () => {
  const cities = ["Bengaluru"];
  assert.equal(conciergeFilterQuery(defaults, cities), "");
  const f = { ...defaults, guests: "300+", space: "banquet", inPolicy: true, sort: "price" };
  const q = conciergeFilterQuery(f, cities);
  assert.deepEqual(parseConciergeFilters(Object.fromEntries(new URLSearchParams(q)), cities), f);
  assert.deepEqual(parseConciergeFilters({ guests: "9000", space: "roof", sort: "x", city: "Pune" }, cities), defaults);
  assert.equal(parseConciergeFilters({}, ["Bengaluru", "Mumbai"]).city, "");
});

test("listing type is optional and must be a known one", () => {
  const base = { ref: "LUF-100", name: "Garden Hall", area: "Jayanagar", city: "Bengaluru", capacity: "120", min_spend_inr: "0" };
  assert.equal(listingSchema.parse({ ...base, category: "" }).category, null);
  assert.equal(listingSchema.parse(base).category, null);
  assert.equal(listingSchema.parse({ ...base, category: "hotel" }).category, "hotel");
  assert.equal(listingSchema.safeParse({ ...base, category: "spa" }).success, false);
});

test("recommended: hotels, fine dining, casual dining, bars, then untyped; by name within a type", () => {
  const cards = toConciergeCards([
    listing(1, { name: "Zed Bar", category: "bar" }),
    listing(2, { name: "No Type" }),
    listing(3, { name: "B Hotel", category: "hotel" }),
    listing(4, { name: "A Hotel", category: "hotel" }),
    listing(5, { name: "Bistro", category: "casual_dining" }),
    listing(6, { name: "Fine", category: "fine_dining" }),
  ]);
  assert.deepEqual(applyConciergeFilters(cards, defaults).map((c) => c.name), ["A Hotel", "B Hotel", "Fine", "Bistro", "Zed Bar", "No Type"]);
});
