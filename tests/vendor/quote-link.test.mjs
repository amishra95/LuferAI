// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Venue quote links (lib/vendor/quote-link.ts): signed, expiring tokens scoped
// to one venue's response; and the quote form's validation (lib/vendor/quote-form.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { composeQuoteNotes, MAX_NOTES, parseQuoteForm, splitQuoteNotes } from "../../lib/vendor/quote-form.ts";
import { QUOTE_LINK_TTL_SECONDS, signQuoteToken, verifyQuoteToken } from "../../lib/vendor/quote-link.ts";

const SECRET = "vendor-link-secret";
const RESPONSE = "eeeeeeee-0001-4000-8000-000000000001";
const VENUE = "cccccccc-0001-4000-8000-000000000001";
const OTHER = "cccccccc-0002-4000-8000-000000000002";
const NOW = 1_800_000_000;
const scope = { responseId: RESPONSE, venueId: VENUE };

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test("a token round-trips to its scope and expires after 7 days by default", () => {
  const token = signQuoteToken(scope, SECRET, { nowSeconds: NOW });
  assert.deepEqual(verifyQuoteToken(token, SECRET, NOW), { ok: true, responseId: RESPONSE, venueId: VENUE, expiresAt: NOW + QUOTE_LINK_TTL_SECONDS });
  assert.equal(QUOTE_LINK_TTL_SECONDS, 7 * 24 * 3600);
});

test("a token is URL-safe and short enough for a WhatsApp message", () => {
  const token = signQuoteToken(scope, SECRET, { nowSeconds: NOW });
  assert.match(token, /^[A-Za-z0-9._-]+$/);
  assert.ok(token.length < 160, `${token.length} characters`);
});

test("expiry: valid until its last second, expired from then on", () => {
  const token = signQuoteToken(scope, SECRET, { nowSeconds: NOW, ttlSeconds: 60 });
  assert.equal(verifyQuoteToken(token, SECRET, NOW + 59).ok, true);
  assert.deepEqual(verifyQuoteToken(token, SECRET, NOW + 60), { ok: false, reason: "expired" });
  assert.deepEqual(verifyQuoteToken(token, SECRET, NOW + 10 * QUOTE_LINK_TTL_SECONDS), { ok: false, reason: "expired" });
});

test("extending the expiry, or pointing the token at another venue or response, breaks the signature", () => {
  const token = signQuoteToken(scope, SECRET, { nowSeconds: NOW });
  const [prefix, response, venue, exp, mac] = token.split(".");
  const forged = [
    [prefix, response, venue, String(Number(exp) + 86_400), mac],
    [prefix, response, OTHER, exp, mac],
    [prefix, "eeeeeeee-0002-4000-8000-000000000002", venue, exp, mac],
    [prefix, response, venue, exp, `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`],
  ];
  for (const parts of forged) assert.deepEqual(verifyQuoteToken(parts.join("."), SECRET, NOW), { ok: false, reason: "bad_signature" }, parts.join("."));
});

test("an expired token with a bad signature is reported as tampered, not expired", () => {
  const [prefix, response, venue, , mac] = signQuoteToken(scope, SECRET, { nowSeconds: NOW }).split(".");
  assert.deepEqual(verifyQuoteToken([prefix, response, venue, String(NOW - 1), mac].join("."), SECRET, NOW), { ok: false, reason: "bad_signature" });
});

test("a token signed with another secret doesn't verify; with no secret, links are off", () => {
  const token = signQuoteToken(scope, "someone-elses-secret", { nowSeconds: NOW });
  assert.deepEqual(verifyQuoteToken(token, SECRET, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifyQuoteToken(signQuoteToken(scope, SECRET, { nowSeconds: NOW }), "", NOW), { ok: false, reason: "unconfigured" });
  assert.throws(() => signQuoteToken(scope, ""), /VENDOR_LINK_SECRET/);
});

test("malformed tokens are refused before any signature check", () => {
  const token = signQuoteToken(scope, SECRET, { nowSeconds: NOW });
  const [, response, venue, exp, mac] = token.split(".");
  for (const bad of [
    "",
    null,
    undefined,
    "hello",
    `q2.${response}.${venue}.${exp}.${mac}`,
    `q1.not-a-uuid.${venue}.${exp}.${mac}`,
    `q1.${response}.${venue}.soon.${mac}`,
    `q1.${response}.${venue}.${exp}`,
    `${token}.extra`,
    token.toUpperCase(),
  ]) {
    assert.deepEqual(verifyQuoteToken(bad, SECRET, NOW), { ok: false, reason: "malformed" }, String(bad));
  }
});

test("IDs are normalised to lower case when signing", () => {
  const token = signQuoteToken({ responseId: RESPONSE.toUpperCase(), venueId: VENUE.toUpperCase() }, SECRET, { nowSeconds: NOW });
  assert.equal(verifyQuoteToken(token, SECRET, NOW).venueId, VENUE);
});

// ---------------------------------------------------------------------------
// The quote form
// ---------------------------------------------------------------------------

const PACKAGES = ["99999999-0001-4000-8000-000000000001"];

test("a quote: the price is read with ₹ and commas, rounded to paise; the package and inclusions are kept", () => {
  const r = parseQuoteForm({ intent: "quote", perHead: "₹ 2,450.555", packageId: PACKAGES[0], inclusions: ["welcome_drink", "av_mic", "av_mic"], notes: "  Min spend ₹1L  " }, PACKAGES);
  assert.deepEqual(r, { ok: true, value: { decline: false, perHeadInr: 2450.56, menuPackageId: PACKAGES[0], notes: "Includes: Welcome drink, AV & mic.\nMin spend ₹1L" } });
});

test("a quote without a package or notes", () => {
  assert.deepEqual(parseQuoteForm({ intent: "quote", perHead: "1800", packageId: "", inclusions: [] }, PACKAGES), { ok: true, value: { decline: false, perHeadInr: 1800, menuPackageId: null, notes: null } });
});

test("a decline needs no price and keeps the note", () => {
  assert.deepEqual(parseQuoteForm({ intent: "decline", perHead: "", notes: "Fully booked that week" }, PACKAGES), { ok: true, value: { decline: true, notes: "Fully booked that week" } });
});

test("bad prices are refused with a message", () => {
  for (const perHead of ["", "0", "-500", "abc", "Infinity"]) {
    assert.deepEqual(parseQuoteForm({ intent: "quote", perHead }, PACKAGES), { ok: false, error: "Enter a per-head price." }, perHead);
  }
  assert.match(parseQuoteForm({ intent: "quote", perHead: "180000" }, PACKAGES).error, /over ₹1,00,000 a head/);
});

test("a package from another venue, an unknown inclusion, long notes or no intent are refused", () => {
  assert.deepEqual(parseQuoteForm({ intent: "quote", perHead: "1800", packageId: "99999999-0009-4000-8000-000000000009" }, PACKAGES), { ok: false, error: "That menu package isn't available." });
  assert.deepEqual(parseQuoteForm({ intent: "quote", perHead: "1800", inclusions: ["helicopter"] }, PACKAGES), { ok: false, error: "Unknown inclusion." });
  assert.match(parseQuoteForm({ intent: "quote", perHead: "1800", notes: "x".repeat(MAX_NOTES + 1) }, PACKAGES).error, /under 500 characters/);
  assert.deepEqual(parseQuoteForm({ perHead: "1800" }, PACKAGES), { ok: false, error: "Choose to send a quote or decline." });
});

test("inclusions round-trip through the response's notes", () => {
  const notes = composeQuoteNotes(["valet", "decor"], "Ask for the terrace");
  assert.equal(notes, "Includes: Valet parking, Basic décor.\nAsk for the terrace");
  assert.deepEqual(splitQuoteNotes(notes), { inclusions: ["valet", "decor"], notes: "Ask for the terrace" });
  assert.deepEqual(splitQuoteNotes(composeQuoteNotes(["valet"], "")), { inclusions: ["valet"], notes: "" });
  assert.equal(composeQuoteNotes([], "  "), null);
});

test("notes a venue wrote by hand are left as text", () => {
  assert.deepEqual(splitQuoteNotes("Includes: a DJ and fireworks.\nCall us"), { inclusions: [], notes: "Includes: a DJ and fireworks.\nCall us" });
  assert.deepEqual(splitQuoteNotes(null), { inclusions: [], notes: "" });
  assert.deepEqual(splitQuoteNotes("Standard rate"), { inclusions: [], notes: "Standard rate" });
});
