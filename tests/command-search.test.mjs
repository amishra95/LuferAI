import { test } from "node:test";
import assert from "node:assert/strict";
import { matchScore, rankMatches } from "../lib/search/match.ts";

test("every word must match, in the title or keywords", () => {
  assert.equal(matchScore("copper", "The Copper Courtyard"), 3);
  assert.equal(matchScore("copper indira", "The Copper Courtyard", "Indiranagar"), 4);
  assert.equal(matchScore("copper koramangala", "The Copper Courtyard", "Indiranagar"), null);
});

test("empty query matches everything; case and accents are ignored", () => {
  assert.equal(matchScore("   ", "Anything"), 0);
  assert.notEqual(matchScore("CAFE", "Café Mezzuna"), null);
});

test("title prefix beats word start beats substring beats keyword-only", () => {
  const items = ["Settings", "Approvals", "Client", "Admin"].map((title) => ({ title, keywords: title === "Admin" ? "settings" : "" }));
  const order = rankMatches(items, "set", (i) => i).map((i) => i.title);
  assert.deepEqual(order, ["Settings", "Admin"]);
  assert.ok(matchScore("court", "The Copper Courtyard") > matchScore("ourt", "The Copper Courtyard"));
});

test("regex characters in the query are literal", () => {
  assert.equal(matchScore("(", "Venue (rooftop)"), 3);
  assert.equal(matchScore(".*", "Venue"), null);
});

test("limit and stable order for ties", () => {
  const items = [{ title: "Alpha one" }, { title: "Alpha two" }, { title: "Alpha three" }];
  assert.deepEqual(rankMatches(items, "alpha", (i) => i, 2).map((i) => i.title), ["Alpha one", "Alpha two"]);
});
