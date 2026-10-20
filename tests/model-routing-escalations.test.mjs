import { test } from "node:test";
import assert from "node:assert/strict";
import { createLatencyTracker, healthOf, isModelUnavailableError, isProviderAccountError, routeOrder, tierOrder, tryInOrder } from "../lib/ai/routing.ts";
import { LLM_PROVIDERS, llmBreakers } from "../lib/circuit-breaker.ts";
import { alertText, parseDecision, parseWhatsAppNumber, priceFor, statusFor } from "../lib/escalations/rules.ts";
import { toTelemetryEvent, visibleTo } from "../lib/telemetry/events.ts";
import { isStale } from "../lib/telemetry/refresh.ts";
import { createDatabase } from "./support/supabase-pglite.mjs";

const status = (provider, over = {}) => ({ provider, configured: true, circuit: "CLOSED", latencyMs: 800, ...over });
const all = (over = {}) => [status("openai", over.openai), status("anthropic", over.anthropic), status("groq", over.groq)];

// --- routing ------------------------------------------------------------------------------

test("tierOrder: the agent's provider, the other premium ones (Gemini first), then the fast tier", () => {
  assert.deepEqual(tierOrder("google"), ["google", "openai", "anthropic", "groq"]);
  assert.deepEqual(tierOrder("openai"), ["openai", "google", "anthropic", "groq"]);
  assert.deepEqual(tierOrder("anthropic"), ["anthropic", "google", "openai", "groq"]);
});

test("routeOrder with Gemini configured: Gemini leads, and OpenAI out of service falls behind the rest", () => {
  const withGoogle = (over = {}) => [status("google", over.google), ...all(over)];
  assert.deepEqual(routeOrder("google", withGoogle()), ["google", "openai", "anthropic", "groq"]);
  assert.deepEqual(routeOrder("google", withGoogle({ google: { circuit: "OPEN" } })), ["openai", "anthropic", "groq", "google"]);
  assert.deepEqual(routeOrder("google", withGoogle({ openai: { configured: false } })), ["google", "anthropic", "groq"]);
  // An agent still saved on gpt-4o tries Gemini second.
  assert.deepEqual(routeOrder("openai", withGoogle()), ["openai", "google", "anthropic", "groq"]);
});

test("routeOrder puts healthy providers first, slow ones next, open circuits last, and skips unconfigured ones", () => {
  assert.deepEqual(routeOrder("openai", all()), ["openai", "anthropic", "groq"]);
  assert.deepEqual(routeOrder("openai", all({ openai: { circuit: "OPEN" } })), ["anthropic", "groq", "openai"]);
  assert.deepEqual(routeOrder("openai", all({ openai: { latencyMs: 20_000 } })), ["anthropic", "groq", "openai"]);
  assert.deepEqual(routeOrder("openai", all({ openai: { latencyMs: 20_000 }, anthropic: { circuit: "OPEN" } })), ["groq", "openai", "anthropic"]);
  assert.deepEqual(routeOrder("anthropic", all({ anthropic: { configured: false } })), ["openai", "groq"]);
  assert.deepEqual(routeOrder("openai", all({ openai: { configured: false }, anthropic: { configured: false }, groq: { configured: false } })), []);
  // Half-open still takes trial calls in its place.
  assert.deepEqual(routeOrder("openai", all({ openai: { circuit: "HALF_OPEN" } })), ["openai", "anthropic", "groq"]);
  assert.equal(healthOf({ circuit: "CLOSED", latencyMs: null }), "healthy");
});

test("the latency tracker smooths samples and ignores bad ones", () => {
  const t = createLatencyTracker(0.5);
  assert.equal(t.get("groq"), null);
  t.record("groq", 1000);
  t.record("groq", 3000);
  assert.equal(t.get("groq"), 2000);
  t.record("groq", -5);
  t.record("groq", Number.NaN);
  assert.equal(t.get("groq"), 2000);
});

test("tryInOrder fails over on unavailability only, and reports who answered", async () => {
  const down = Object.assign(new Error("OpenAI is unavailable (503)."), { unavailable: true });
  const shouldFailOver = (e) => e?.unavailable === true;
  const skipped = [];
  const r = await tryInOrder(["openai", "anthropic", "groq"], async (p) => (p === "openai" ? Promise.reject(down) : `answer from ${p}`), {
    shouldFailOver,
    onSkip: (from, to) => skipped.push(`${from}>${to}`),
  });
  assert.deepEqual({ result: r.result, provider: r.provider, index: r.index, errors: r.errors.length }, { result: "answer from anthropic", provider: "anthropic", index: 1, errors: 1 });
  assert.deepEqual(skipped, ["openai>anthropic"]);

  const bad = new Error("400 invalid tool schema");
  await assert.rejects(tryInOrder(["openai", "anthropic"], async () => Promise.reject(bad), { shouldFailOver }), /400/);
  const calls = [];
  await assert.rejects(
    tryInOrder(["openai", "anthropic", "groq"], async (p) => (calls.push(p), Promise.reject(down)), { shouldFailOver }),
    /unavailable/
  );
  assert.deepEqual(calls, ["openai", "anthropic", "groq"]);
  await assert.rejects(tryInOrder(["openai", "groq"], async () => Promise.reject(down), { shouldFailOver, aborted: () => true }));
  await assert.rejects(tryInOrder([], async () => "x", { shouldFailOver }), /No AI provider/);
});

test("account refusals (credits, quota, key) fail over; request errors don't", async () => {
  // As OpenAI sends it: inside an HTTP 200 stream, so there's no status code to go on.
  const noCredits = Object.assign(new Error("You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/."), { name: "AI_APICallError" });
  assert.equal(isProviderAccountError(noCredits), true);
  assert.equal(isProviderAccountError({ statusCode: 429, message: "You exceeded your current quota, please check your plan and billing details." }), true);
  assert.equal(isProviderAccountError({ statusCode: 401, message: "Incorrect API key provided" }), true);
  assert.equal(isProviderAccountError({ statusCode: 400, message: "Your credit balance is too low to access the Anthropic API." }), true);
  assert.equal(isProviderAccountError(new Error("wrapped", { cause: { statusCode: 403 } })), true);
  // The caller's own mistakes stay with the caller.
  assert.equal(isProviderAccountError({ statusCode: 400, message: "Invalid schema for function 'searchVenues'" }), false);
  assert.equal(isProviderAccountError(new Error("context_length_exceeded")), false);

  const { result, provider, errors } = await tryInOrder(["openai", "anthropic"], async (p) => {
    if (p === "openai") throw noCredits;
    return "answer";
  }, { shouldFailOver: isProviderAccountError });
  assert.deepEqual([result, provider, errors.length], ["answer", "anthropic", 1]);
});

test("a retired or unknown model is recognised, so the fast tier can fall back to the standard model", () => {
  // As Google answers for retired models today.
  assert.equal(isModelUnavailableError({ statusCode: 404, message: "This model models/gemini-2.0-flash is no longer available." }), true);
  assert.equal(isModelUnavailableError(new Error("models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent.")), true);
  assert.equal(isModelUnavailableError(new Error("wrapped", { cause: { statusCode: 404 } })), true);
  assert.equal(isModelUnavailableError({ statusCode: 429, message: "Resource exhausted" }), false);
  assert.equal(isModelUnavailableError({ statusCode: 400, message: "Invalid schema for function" }), false);
});

test("each provider has its own breaker, tuned to hand off after one retry", () => {
  assert.deepEqual(LLM_PROVIDERS.map((p) => llmBreakers[p].name), ["llm.google", "llm.openai", "llm.anthropic", "llm.groq"]);
  assert.notEqual(llmBreakers.openai, llmBreakers.groq);
});

// --- escalation decisions ---------------------------------------------------------------------

test("parseDecision reads approve, modify (with a price) and reject", () => {
  assert.deepEqual(parseDecision({ action: "approve", note: "  ok " }), { ok: true, value: { action: "approve", note: "ok" } });
  assert.deepEqual(parseDecision({ action: "modify", perHead: "₹2,150", note: "" }), { ok: true, value: { action: "modify", perHead: 2150, note: null } });
  assert.equal(parseDecision({ action: "modify", perHead: "0" }).ok, false);
  assert.equal(parseDecision({ action: "modify", perHead: "abc" }).ok, false);
  assert.equal(parseDecision({ action: "delete" }).ok, false);
  const reject = parseDecision({ action: "reject" }).value;
  assert.equal(statusFor(reject), "rejected");
  assert.equal(priceFor(reject, 1800), null);
  assert.equal(priceFor(parseDecision({ action: "approve" }).value, 1800), 1800);
  assert.equal(priceFor(parseDecision({ action: "modify", perHead: 1950 }).value, 1800), 1950);
});

test("alert texts name the venue, client, price and link", () => {
  const s = { venue: "Copper Courtyard", company: "Northwind", partySize: 40, eventDate: "2026-11-20", proposedPerHead: 1700, standardPerHead: 2000, reason: "Escalated to the host: 15% off." };
  const opened = alertText("opened", s, "https://x/property");
  assert.match(opened, /Counter-offer needs review\* at Copper Courtyard/);
  assert.match(opened, /Proposed ₹1,700\/head \(15.0% off ₹2,000\)/);
  assert.match(opened, /https:\/\/x\/property/);
  assert.match(alertText("decided", s, "l", { status: "modified", perHead: 1850, by: "host@venue.in" }), /sent at ₹1,850\/head by host@venue.in/);
  assert.match(alertText("decided", s, "l", { status: "rejected", perHead: null, by: "an admin" }), /rejected; the instant quote stands/);
});

test("parseWhatsAppNumber normalises Indian mobiles and requires a country code otherwise", () => {
  assert.deepEqual(parseWhatsAppNumber("98450 12345"), { ok: true, value: "+919845012345" });
  assert.deepEqual(parseWhatsAppNumber("09845012345"), { ok: true, value: "+919845012345" });
  assert.deepEqual(parseWhatsAppNumber("+44 20 7946 0958"), { ok: true, value: "+442079460958" });
  assert.deepEqual(parseWhatsAppNumber(" "), { ok: true, value: null });
  assert.equal(parseWhatsAppNumber("12345").ok, false);
});

// --- live events --------------------------------------------------------------------------------

test("escalation events parse, reach admins and only their own venue's host, and refresh the queues", () => {
  const e = toTelemetryEvent({ seq: 4, at: 1, type: "escalation", escalationId: "e1", venueId: "v1", status: "open" });
  assert.deepEqual(e, { seq: 4, at: 1, type: "escalation", escalationId: "e1", venueId: "v1", status: "open" });
  assert.equal(toTelemetryEvent({ seq: 4, at: 1, type: "escalation", escalationId: "e1", venueId: "v1", status: "maybe" }), null);
  assert.equal(visibleTo(e, { ops: true, venues: false }), true);
  assert.equal(visibleTo(e, { ops: false, venues: false, venueId: "v1" }), true);
  assert.equal(visibleTo(e, { ops: false, venues: false, venueId: "v2" }), false);
  assert.equal(visibleTo(e, { ops: false, venues: true }), false);
  // A host's audience hears nothing else operational.
  assert.equal(visibleTo({ type: "booking", venueId: "v1" }, { ops: false, venues: false, venueId: "v1" }), false);
  assert.equal(isStale("/property", [e]), true);
  assert.equal(isStale("/agents", [e]), true);
  assert.equal(isStale("/client", [e]), false);
});

// --- migration 0029 ------------------------------------------------------------------------------

test("negotiation escalations: one open per response, a consistent decision, and an append-only trail", async () => {
  const db = await createDatabase();
  const {
    rows: [venue],
  } = await db.query("select id from public.venues limit 1");
  const {
    rows: [company],
  } = await db.query("select id from public.companies limit 1");
  const {
    rows: [rfp],
  } = await db.query("insert into public.rfps (company_id, brief, party_size, requirements) values ($1, 'Team dinner', 40, '{}') returning id", [company.id]);
  const {
    rows: [response],
  } = await db.query("insert into public.rfp_responses (rfp_id, venue_id, status) values ($1, $2, 'quoted') returning id", [rfp.id, venue.id]);
  const open = (sql = "") =>
    db.query(`insert into public.negotiation_escalations (rfp_id, response_id, venue_id, proposed_per_head_inr, standard_per_head_inr, party_size, reason${sql ? ", status, decided_at" : ""}) values ($1, $2, $3, 1700, 2000, 40, 'Escalated'${sql}) returning id`, [rfp.id, response.id, venue.id]);
  const {
    rows: [esc],
  } = await open();
  await assert.rejects(open(), /duplicate|unique/i); // a second open one on the same response
  await assert.rejects(db.query("update public.negotiation_escalations set status = 'approved' where id = $1", [esc.id])); // decided without decided_at
  await db.query("update public.negotiation_escalations set status = 'approved', decided_at = now(), decided_per_head_inr = 1700 where id = $1", [esc.id]);
  await open(); // the previous one is decided, so a new open one is allowed

  const {
    rows: [ev],
  } = await db.query("insert into public.negotiation_escalation_events (escalation_id, action, detail) values ($1, 'opened', '{}') returning id", [esc.id]);
  await assert.rejects(db.query("update public.negotiation_escalation_events set action = 'approved' where id = $1", [ev.id]), /append-only/);
  await assert.rejects(db.query("delete from public.negotiation_escalation_events where id = $1", [ev.id]), /append-only/);
  await assert.rejects(db.query("insert into public.negotiation_escalation_events (escalation_id, action) values ($1, 'deleted')", [esc.id]));

  await db.query("insert into public.venue_negotiation_rules (venue_id, alert_whatsapp) values ($1, '+919845012345')", [venue.id]);
  await assert.rejects(db.query("update public.venue_negotiation_rules set alert_whatsapp = '98450' where venue_id = $1", [venue.id]));
});
