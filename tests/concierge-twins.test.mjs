import assert from "node:assert/strict";
import test from "node:test";

import { conciergeTwins, venueKey } from "../lib/venues/concierge-twins.ts";

const listings = [
  { id: "1", name: "The Fatty Bao", area: "Indiranagar" },
  { id: "2", name: "Barbeque Nation (Indiranagar)", area: "Indiranagar" },
  { id: "3", name: "Bob’s Bar", area: "Indiranagar" },
  { id: "4", name: "The Oberoi, Bengaluru", area: "MG Road" },
  { id: "5", name: "Vapour Pub & Brewery", area: "Indiranagar" },
];

test("names normalise across punctuation, 'The', city and outlet suffixes", () => {
  assert.equal(venueKey("The Fatty Bao (Indiranagar)"), "fatty bao");
  assert.equal(venueKey("Bob's Bar"), venueKey("Bob’s Bar"));
  assert.equal(venueKey("The Oberoi, Bengaluru"), "oberoi");
  assert.equal(venueKey("Vapour Pub and Brewery"), venueKey("Vapour Pub & Brewery"));
});

test("a venue going live finds its own listing", () => {
  assert.deepEqual(conciergeTwins({ name: "Fatty Bao", neighborhood: "Indiranagar" }, listings).map((l) => l.id), ["1"]);
  assert.deepEqual(conciergeTwins({ name: "The Oberoi", neighborhood: "MG Road" }, listings).map((l) => l.id), ["4"]);
  assert.deepEqual(conciergeTwins({ name: "Bob's Bar", neighborhood: "Indiranagar" }, listings).map((l) => l.id), ["3"]);
});

test("another outlet of a chain, or a different place, doesn't pause anything", () => {
  assert.deepEqual(conciergeTwins({ name: "Barbeque Nation", neighborhood: "Koramangala" }, listings), []);
  assert.deepEqual(conciergeTwins({ name: "Toit", neighborhood: "Indiranagar" }, listings), []);
  assert.deepEqual(conciergeTwins({ name: "The", neighborhood: "Indiranagar" }, listings), []);
});
