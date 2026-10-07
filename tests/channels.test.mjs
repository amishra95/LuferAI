import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { mergeParsed, parseReservationText } from "../lib/channels/parse-reservation.ts";
import { tokensMatch, verifyMetaSignature, verifySlackSignature } from "../lib/channels/signatures.ts";

const catalogue = {
  venueNames: ["The Copper Courtyard", "Saffron Terrace", "Mosaic Kitchen & Bar"],
  areas: ["Indiranagar", "Koramangala"],
};
const TODAY = "2026-10-07";

test("parses guests, day-month date, per-head budget, area and PDR from a search message", () => {
  const r = parseReservationText("Team dinner for 40 in Indiranagar on 20 Nov, ₹2,500 a head, private room please", catalogue, TODAY);
  assert.deepEqual(r, {
    intent: "search",
    guests: 40,
    date: "2026-11-20",
    budgetPerHead: 2500,
    area: "Indiranagar",
    venueName: undefined,
    wantsPrivateDining: true,
    costCenter: undefined,
    projectCode: undefined,
  });
});

test("detects booking intent and a named venue; date digits are not read as guests", () => {
  const r = parseReservationText("Book Copper Courtyard on 2026-11-20 for 35 people, 2200 per head", catalogue, TODAY);
  assert.equal(r.intent, "book");
  assert.equal(r.venueName, "The Copper Courtyard");
  assert.equal(r.date, "2026-11-20");
  assert.equal(r.guests, 35);
  assert.equal(r.budgetPerHead, 2200);
});

test("day-first numeric dates, k-suffixed budgets and month-first dates", () => {
  assert.equal(parseReservationText("on 05/12/2026", catalogue, TODAY).date, "2026-12-05");
  assert.equal(parseReservationText("Dec 5 for 12 pax", catalogue, TODAY).date, "2026-12-05");
  assert.equal(parseReservationText("₹2.5k per person", catalogue, TODAY).budgetPerHead, 2500);
});

test("a day-month without a year that has passed rolls to next year", () => {
  assert.equal(parseReservationText("1 Feb for 20 guests", catalogue, TODAY).date, "2027-02-01");
  assert.equal(parseReservationText("tomorrow", catalogue, TODAY).date, "2026-10-08");
});

test("invalid dates are ignored rather than guessed", () => {
  assert.equal(parseReservationText("31/02/2027 for 10 people", catalogue, TODAY).date, undefined);
});

test("Meta signature: accepts the correct HMAC, rejects tampering and a missing secret", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const sig = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, sig, "app-secret"), true);
  assert.equal(verifyMetaSignature(`${body} `, sig, "app-secret"), false);
  assert.equal(verifyMetaSignature(body, sig, ""), false);
  assert.equal(verifyMetaSignature(body, null, "app-secret"), false);
});

test("Slack signature: valid within the window, rejected when stale or altered", () => {
  const body = "token=x&type=event_callback";
  const ts = "1790000000";
  const sig = `v0=${createHmac("sha256", "signing").update(`v0:${ts}:${body}`).digest("hex")}`;
  assert.equal(verifySlackSignature(body, ts, sig, "signing", 1790000100), true);
  assert.equal(verifySlackSignature(body, ts, sig, "signing", 1790000000 + 301), false);
  const tampered = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
  assert.equal(verifySlackSignature(body, ts, tampered, "signing", 1790000100), false);
  assert.equal(verifySlackSignature(`${body}&x=1`, ts, sig, "signing", 1790000100), false);
  assert.equal(verifySlackSignature(body, "abc", sig, "signing", 1790000100), false);
});

test("verify-token comparison requires both values", () => {
  assert.equal(tokensMatch("abc", "abc"), true);
  assert.equal(tokensMatch("abc", "abd"), false);
  assert.equal(tokensMatch(null, "abc"), false);
  assert.equal(tokensMatch("", ""), false);
});

test("multi-turn: a later 'book <venue>' reuses guests, date and budget from the earlier search", () => {
  const earlier = parseReservationText("Dinner for 40 in Indiranagar on 20 Nov, ₹2,800 a head", catalogue, TODAY);
  const merged = mergeParsed(parseReservationText("book Copper Courtyard", catalogue, TODAY), [earlier]);
  assert.equal(merged.intent, "book");
  assert.equal(merged.venueName, "The Copper Courtyard");
  assert.equal(merged.guests, 40);
  assert.equal(merged.date, "2026-11-20");
  assert.equal(merged.budgetPerHead, 2800);
});

test("multi-turn: details sent after a booking request complete it; newer values win", () => {
  const asked = parseReservationText("book Saffron Terrace for 30 people", catalogue, TODAY);
  const merged = mergeParsed(parseReservationText("20 Nov, ₹2,000 a head, actually 35 guests", catalogue, TODAY), [asked]);
  assert.equal(merged.intent, "book");
  assert.equal(merged.venueName, "Saffron Terrace");
  assert.equal(merged.guests, 35);
  assert.equal(merged.date, "2026-11-20");
});

test("multi-turn: a fresh search in a new area isn't treated as a booking", () => {
  const asked = parseReservationText("book Saffron Terrace", catalogue, TODAY);
  const merged = mergeParsed(parseReservationText("what about Koramangala for 60?", catalogue, TODAY), [asked]);
  assert.equal(merged.intent, "search");
  assert.equal(merged.area, "Koramangala");
});
