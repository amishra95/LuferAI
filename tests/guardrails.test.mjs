import { test } from "node:test";
import assert from "node:assert/strict";

import { bookingRules, checkToolCall, menuPackageRules, minimumSpendRules } from "../lib/guardrails/engine.ts";
import { GUARDRAIL_LIMITS, createBookingInput, setMinimumSpendInput, upsertMenuPackageInput } from "../lib/guardrails/schemas.ts";
import { tracer } from "../lib/tracer.ts";

const booking = { venueName: "The Copper Courtyard", eventDate: "2026-11-20", partySize: 40, budgetPerHead: 2500 };
const ctx = { today: "2026-10-08", linked: true, bookingsLastHour: 0, duplicate: false };
const PKG = "9b2f0d6e-3c1a-4c55-9a51-0d6d1c3b7a11";
const OTHER = "6f1e7c2a-8d4b-4f0e-b1a2-3c4d5e6f7a8b";
const pkg = { package_id: PKG, name: "Veg thali", per_head_inr: 1800, dietary_tags: ["vegetarian"], description: null, is_active: true, reason: "Match RFP budgets" };

test("booking rules: link, horizon, duplicates and hourly limit, in that order", () => {
  assert.equal(bookingRules(booking, ctx).allowed, true);
  assert.equal(bookingRules(booking, { ...ctx, linked: false }).code, "not_linked");
  assert.equal(bookingRules({ ...booking, eventDate: "2027-10-08" }, ctx).allowed, true); // exactly 365 days
  assert.equal(bookingRules({ ...booking, eventDate: "2027-10-09" }, ctx).code, "date_out_of_range");
  assert.equal(bookingRules(booking, { ...ctx, duplicate: true }).code, "duplicate_request");
  assert.equal(bookingRules(booking, { ...ctx, bookingsLastHour: GUARDRAIL_LIMITS.booking.perSenderPerHour - 1 }).allowed, true);
  const limited = bookingRules(booking, { ...ctx, bookingsLastHour: GUARDRAIL_LIMITS.booking.perSenderPerHour });
  assert.equal(limited.code, "rate_limited");
  assert.match(limited.message, /3 booking requests in the last hour/);
});

test("minimum spend: at most ±50% per change, with the allowed range in the message", () => {
  assert.equal(minimumSpendRules({ min_spend_inr: 112_500, reason: "x" }, { current: 75_000 }).allowed, true); // +50%
  assert.equal(minimumSpendRules({ min_spend_inr: 37_500, reason: "x" }, { current: 75_000 }).allowed, true); // −50%
  const cut = minimumSpendRules({ min_spend_inr: 3_750, reason: "RFP says so" }, { current: 75_000 });
  assert.equal(cut.code, "change_too_large");
  assert.match(cut.message, /95% change.*₹37,500 and ₹1,12,500/);
  assert.equal(cut.facts.changePct, 95);
  assert.equal(minimumSpendRules({ min_spend_inr: 50_000, reason: "x" }, { current: 0 }).allowed, true); // no baseline
});

test("menu packages: price band, unknown ids, never the last active package", () => {
  const two = { activePackageIds: [PKG, OTHER], packageExists: true };
  assert.equal(menuPackageRules(pkg, two).allowed, true);
  assert.equal(menuPackageRules({ ...pkg, per_head_inr: 99 }, two).code, "price_out_of_range");
  assert.equal(menuPackageRules({ ...pkg, per_head_inr: 50_001 }, two).code, "price_out_of_range");
  assert.equal(menuPackageRules(pkg, { ...two, packageExists: false }).code, "unknown_package");
  assert.equal(menuPackageRules({ ...pkg, is_active: false }, two).allowed, true);
  assert.equal(menuPackageRules({ ...pkg, is_active: false }, { activePackageIds: [PKG], packageExists: true }).code, "last_active_package");
  // Deactivating an already-inactive package, or creating one inactive, is fine.
  assert.equal(menuPackageRules({ ...pkg, is_active: false }, { activePackageIds: [OTHER], packageExists: true }).allowed, true);
  assert.equal(menuPackageRules({ ...pkg, package_id: null, is_active: false }, { activePackageIds: [], packageExists: true }).allowed, true);
});

test("schemas are strict about what the model may send", () => {
  assert.equal(createBookingInput.safeParse({ ...booking, partySize: 4.5 }).success, false);
  assert.equal(createBookingInput.safeParse({ ...booking, eventDate: "20 Nov" }).success, false);
  assert.equal(createBookingInput.safeParse({ ...booking, venueName: "   " }).success, false);
  assert.equal(setMinimumSpendInput.safeParse({ min_spend_inr: -1, reason: "x" }).success, false);
  assert.equal(setMinimumSpendInput.safeParse({ min_spend_inr: 1000, reason: "" }).success, false);
  assert.equal(upsertMenuPackageInput.safeParse({ ...pkg, dietary_tags: ["keto"] }).success, false);
  assert.equal(upsertMenuPackageInput.safeParse({ ...pkg, package_id: "not-a-uuid" }).success, false);
});

test("checkToolCall: re-validates input, applies rules, and audits every decision as a span", async () => {
  let rulesRan = 0;
  const bad = await checkToolCall("createBooking", { ...booking, partySize: "forty" }, () => {
    rulesRan++;
    return { allowed: true };
  }, { channel: "whatsapp" });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "invalid_input");
  assert.match(bad.message, /partySize/);
  assert.equal(rulesRan, 0);

  const denied = await checkToolCall("setMinimumSpend", { min_spend_inr: 1000, reason: "cut" }, (a) => minimumSpendRules(a, { current: 75_000 }), { venueId: "v1" });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "change_too_large");

  const ok = await checkToolCall("createBooking", { ...booking, venueName: "  The Copper Courtyard  " }, (a) => bookingRules(a, ctx), { channel: "slack" });
  assert.equal(ok.ok, true);
  assert.equal(ok.args.venueName, "The Copper Courtyard"); // parsed (trimmed) args are what callers act on

  await new Promise((r) => setTimeout(r, 0)); // trace writes are deferred
  const traces = (await tracer.listTraces({ limit: 10 })).filter((t) => t.name.startsWith("guardrail."));
  const byCode = Object.fromEntries(traces.map((t) => [t.spans[0].attributes.code ?? "allowed", t.spans[0]]));
  assert.equal(byCode.change_too_large.status, "error");
  assert.equal(byCode.change_too_large.error.name, "GuardrailDenied");
  assert.equal(byCode.change_too_large.attributes.decision, "deny");
  assert.equal(byCode.change_too_large.attributes.venueId, "v1");
  assert.equal(byCode.change_too_large.attributes.changePct, 99);
  assert.equal(byCode.invalid_input.attributes.tool, "createBooking");
  assert.equal(byCode.allowed.status, "ok");
  assert.equal(byCode.allowed.attributes.decision, "allow");
  assert.equal(byCode.allowed.attributes.channel, "slack");
});
