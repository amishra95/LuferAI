import { test } from "node:test";
import assert from "node:assert/strict";
import { conciergeHref, draftFromParam, MAX_DRAFT_LENGTH, teamEventPrompt, venueEventPrompt } from "../lib/chat/concierge-link.ts";

test("conciergeHref: plain /chat without context", () => {
  assert.equal(conciergeHref(), "/chat");
  assert.equal(conciergeHref({ companyId: null, prompt: "   " }), "/chat");
});

test("conciergeHref: company and draft travel as encoded query params", () => {
  const href = conciergeHref({ companyId: "c-1", prompt: "Dinner for 40 & drinks" });
  const url = new URL(href, "https://x.test");
  assert.equal(url.pathname, "/chat");
  assert.equal(url.searchParams.get("company"), "c-1");
  assert.equal(url.searchParams.get("prompt"), "Dinner for 40 & drinks");
});

test("conciergeHref and draftFromParam cap the draft length", () => {
  const long = "a".repeat(MAX_DRAFT_LENGTH + 50);
  assert.equal(new URL(conciergeHref({ prompt: long }), "https://x.test").searchParams.get("prompt").length, MAX_DRAFT_LENGTH);
  assert.equal(draftFromParam(long).length, MAX_DRAFT_LENGTH);
});

test("draftFromParam: first value of a repeated param, trimmed; empty when absent", () => {
  assert.equal(draftFromParam(["  first ", "second"]), "first");
  assert.equal(draftFromParam(undefined), "");
});

test("teamEventPrompt names the company", () => {
  assert.match(teamEventPrompt("Nimbus Analytics Private Limited"), /for Nimbus Analytics Private Limited:/);
});

test("venueEventPrompt names the venue and its area", () => {
  const venue = { name: "Mosaic Kitchen & Bar", neighborhood: "Koramangala", city: "Bengaluru" };
  assert.equal(
    venueEventPrompt(venue),
    "I want to request a corporate event at Mosaic Kitchen & Bar (Koramangala, Bengaluru). Please help me structure the request with date, guest count, and budget."
  );
  assert.match(venueEventPrompt(venue, "rfp"), /^I want to send an RFP for a corporate event to Mosaic Kitchen & Bar \(Koramangala, Bengaluru\)\./);
  assert.match(venueEventPrompt({ name: "Solo", neighborhood: null, city: "" }), /at Solo\. /);
});
