// Run with: npm test   (uses Node's built-in test runner + TypeScript type stripping)
//
// Venue quote links end to end: the page loader (lib/vendor/quote-service.ts)
// and the form's server action (app/(vendor)/quote/[token]/actions.ts), against
// a local stand-in for Supabase's REST API (PostgREST) that filters fixture rows
// by the query's eq. filters and records every request. RFPs live only in Supabase.
import "../support/server-actions.mjs";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { signQuoteToken } from "../../lib/vendor/quote-link.ts";

const { loadVendorQuote, quoteLinkMessage, submitVendorQuote, vendorQuoteUrl } = await import("../../lib/vendor/quote-service.ts");
const { submitQuoteAction } = await import("../../app/(vendor)/quote/[token]/actions.ts");

const SECRET = "vendor-link-secret";
const VENUE = "cccccccc-0001-4000-8000-000000000001";
const OTHER_VENUE = "cccccccc-0002-4000-8000-000000000002";
const RESPONSE = "eeeeeeee-0001-4000-8000-000000000001";
const OTHER_RESPONSE = "eeeeeeee-0002-4000-8000-000000000002";
const CLOSED_RESPONSE = "eeeeeeee-0003-4000-8000-000000000003";
const PACKAGE = "99999999-0001-4000-8000-000000000001";
const OTHER_PACKAGE = "99999999-0002-4000-8000-000000000002";

const rfp = (status) => ({
  brief: "Offsite dinner for the sales team, vegetarian-heavy.",
  party_size: 40,
  event_date: "2026-12-05",
  event_start_time: "19:30:00",
  event_type: "team_dinner",
  budget_per_head_inr: "2000",
  dietary_tags: ["vegetarian"],
  status,
  city: "Bengaluru",
  company: { legal_name: "Nimbus Technologies" },
});
const response = (id, venueId, status, rfpStatus = "open") => ({
  id,
  venue_id: venueId,
  status,
  per_head_inr: "1850",
  menu_package_id: null,
  notes: "Includes: Welcome drink.\nStandard rate",
  venue: { name: venueId === VENUE ? "Saffron Terrace" : "Mosaic Kitchen" },
  rfp: rfp(rfpStatus),
});
const TABLES = {
  rfp_responses: [response(RESPONSE, VENUE, "quoted"), response(OTHER_RESPONSE, OTHER_VENUE, "quoted"), response(CLOSED_RESPONSE, VENUE, "countered", "awarded")],
  venue_menu_packages: [
    { id: PACKAGE, venue_id: VENUE, name: "Veg Feast", per_head_inr: "1800", dietary_tags: ["vegetarian"], description: "5 courses", is_active: true },
    { id: "99999999-0003-4000-8000-000000000003", venue_id: VENUE, name: "Retired menu", per_head_inr: "1200", dietary_tags: [], description: null, is_active: false },
    { id: OTHER_PACKAGE, venue_id: OTHER_VENUE, name: "Other venue's menu", per_head_inr: "900", dietary_tags: [], description: null, is_active: true },
  ],
};

// ---------------------------------------------------------------------------
// A minimal PostgREST: GET filters fixture rows by eq. params; writes are recorded.
// ---------------------------------------------------------------------------

let server;
let requests = [];
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const table = url.pathname.replace(/^\/rest\/v1\//, "");
      requests.push({ method: req.method, table, params: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null });
      const send = (status, json) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(json === undefined ? "" : JSON.stringify(json));
      };
      if (req.method !== "GET") return req.headers.prefer?.includes("return=representation") ? send(200, []) : send(204);
      const filters = [...url.searchParams].filter(([k, v]) => !["select", "order", "limit"].includes(k) && v.startsWith("eq."));
      const rows = (TABLES[table] ?? []).filter((r) => filters.every(([k, v]) => String(r[k]) === v.slice(3)));
      if (req.headers.accept?.includes("vnd.pgrst.object")) return rows.length === 1 ? send(200, rows[0]) : send(406, { code: "PGRST116", message: "0 rows" });
      send(200, rows);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
});
after(() => {
  server.close();
  for (const k of ["VENDOR_LINK_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL"]) delete process.env[k];
});
beforeEach(() => {
  requests = [];
  process.env.VENDOR_LINK_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
});

const tokenFor = (responseId, venueId, opts) => signQuoteToken({ responseId, venueId }, SECRET, opts);
const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
};
const writes = () => requests.filter((r) => r.method !== "GET");
const responseUpdate = () => writes().find((r) => r.table === "rfp_responses" && r.method === "PATCH");

// ---------------------------------------------------------------------------
// Opening a link
// ---------------------------------------------------------------------------

test("a valid link opens its venue's response: the RFP, the current quote and the venue's active packages", async () => {
  const loaded = await loadVendorQuote(tokenFor(RESPONSE, VENUE));
  assert.equal(loaded.status, "open");
  const { view } = loaded;
  assert.equal(view.venueName, "Saffron Terrace");
  assert.equal(view.companyName, "Nimbus Technologies");
  assert.equal(view.rfp.party_size, 40);
  assert.equal(view.rfp.budget_per_head_inr, 2000);
  assert.deepEqual(view.current, { status: "quoted", perHeadInr: 1850, menuPackageId: null, inclusions: ["welcome_drink"], notes: "Standard rate" });
  assert.deepEqual(view.packages.map((p) => [p.id, p.perHeadInr]), [[PACKAGE, 1800]]);

  // The read is scoped to the token's response and venue.
  const read = requests.find((r) => r.table === "rfp_responses");
  assert.equal(read.params.id, `eq.${RESPONSE}`);
  assert.equal(read.params.venue_id, `eq.${VENUE}`);
});

test("a link can't open another venue's response, even when correctly signed for a mismatched pair", async () => {
  assert.deepEqual(await loadVendorQuote(tokenFor(OTHER_RESPONSE, VENUE)), { status: "invalid" });
});

test("a link to an awarded or closed RFP opens read-only as closed", async () => {
  assert.equal((await loadVendorQuote(tokenFor(CLOSED_RESPONSE, VENUE))).status, "closed");
});

test("expired, tampered and unsigned links are refused without touching the database", async () => {
  const expired = tokenFor(RESPONSE, VENUE, { nowSeconds: Math.floor(Date.now() / 1000) - 8 * 86_400 });
  assert.deepEqual(await loadVendorQuote(expired), { status: "expired" });
  const [p, , v, e, m] = tokenFor(RESPONSE, VENUE).split(".");
  assert.deepEqual(await loadVendorQuote([p, OTHER_RESPONSE, v, e, m].join(".")), { status: "invalid" });
  assert.deepEqual(await loadVendorQuote("not-a-token"), { status: "invalid" });
  delete process.env.VENDOR_LINK_SECRET;
  assert.deepEqual(await loadVendorQuote(tokenFor(RESPONSE, VENUE)), { status: "unavailable" });
  assert.equal(requests.length, 0);
});

test("without Supabase, links are unavailable", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.deepEqual(await loadVendorQuote(tokenFor(RESPONSE, VENUE)), { status: "unavailable" });
});

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

test("sending a quote counters this venue's response with the price, package and inclusions", async () => {
  const state = await submitQuoteAction(tokenFor(RESPONSE, VENUE), null, form({ intent: "quote", perHead: "1,750", packageId: PACKAGE, inclusions: ["av_mic", "decor"], notes: "Terrace on request" }));
  assert.deepEqual(state, { ok: true, declined: false });
  const update = responseUpdate();
  assert.ok(update, `no update; requests: ${JSON.stringify(requests.map((r) => `${r.method} ${r.table}`))}`);
  assert.equal(update.params.id, `eq.${RESPONSE}`);
  assert.equal(update.body.status, "countered");
  assert.equal(update.body.source, "venue");
  assert.equal(update.body.per_head_inr, 1750);
  assert.equal(update.body.list_amount_inr, 1750 * 40);
  assert.equal(update.body.menu_package_id, PACKAGE);
  assert.equal(update.body.notes, "Includes: AV & mic, Basic décor.\nTerrace on request");
});

test("declining needs no price", async () => {
  const state = await submitQuoteAction(tokenFor(RESPONSE, VENUE), null, form({ intent: "decline", notes: "Booked out" }));
  assert.deepEqual(state, { ok: true, declined: true });
  assert.equal(responseUpdate().body.status, "declined");
  assert.equal(responseUpdate().body.notes, "Booked out");
});

test("another venue's package is refused before anything is written", async () => {
  const state = await submitQuoteAction(tokenFor(RESPONSE, VENUE), null, form({ intent: "quote", perHead: "900", packageId: OTHER_PACKAGE }));
  assert.deepEqual(state, { ok: false, error: "That menu package isn't available." });
  assert.equal(writes().length, 0);
});

test("a closed RFP can't be quoted from its link", async () => {
  const state = await submitQuoteAction(tokenFor(CLOSED_RESPONSE, VENUE), null, form({ intent: "quote", perHead: "1500" }));
  assert.deepEqual(state, { ok: false, error: "This RFP is closed." });
  assert.equal(writes().length, 0);
});

test("expired and tampered links can't submit, and nothing is read or written", async () => {
  const expired = tokenFor(RESPONSE, VENUE, { nowSeconds: Math.floor(Date.now() / 1000) - 8 * 86_400 });
  assert.deepEqual(await submitQuoteAction(expired, null, form({ intent: "quote", perHead: "1500" })), { ok: false, error: "This link has expired. Ask the client for a new one." });
  const [p, r, , e, m] = tokenFor(RESPONSE, VENUE).split(".");
  assert.deepEqual(await submitQuoteAction([p, r, OTHER_VENUE, e, m].join("."), null, form({ intent: "quote", perHead: "1500" })), { ok: false, error: "This link isn't valid." });
  // submitVendorQuote re-checks the token itself.
  assert.deepEqual(await submitVendorQuote(expired, { decline: true, notes: null }), { ok: false, error: "This link has expired. Ask the client for a new one." });
  assert.equal(requests.length, 0);
});

test("an invalid price comes back as a message", async () => {
  assert.deepEqual(await submitQuoteAction(tokenFor(RESPONSE, VENUE), null, form({ intent: "quote", perHead: "0" })), { ok: false, error: "Enter a per-head price." });
  assert.equal(writes().length, 0);
});

// ---------------------------------------------------------------------------
// Sending links
// ---------------------------------------------------------------------------

test("vendorQuoteUrl builds a working link on the public site, or none while links are off", async () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://lufer.example";
  const url = vendorQuoteUrl(RESPONSE, VENUE);
  assert.match(url, /^https:\/\/lufer\.example\/quote\/q1\./);
  assert.equal((await loadVendorQuote(url.split("/quote/")[1])).status, "open");
  delete process.env.VENDOR_LINK_SECRET;
  assert.equal(vendorQuoteUrl(RESPONSE, VENUE), null);
});

test("the link message names the client, the event and the price already sent", () => {
  assert.equal(
    quoteLinkMessage({ companyName: "Nimbus", partySize: 40, eventDate: "2026-12-05", perHeadInr: 1850, url: "https://x/quote/t" }),
    "New event request from Nimbus: 40 guests on 2026-12-05. We've sent them your standard ₹1,850 a head. Adjust your price and inclusions, or decline, in 30 seconds (no login): https://x/quote/t"
  );
  assert.doesNotMatch(quoteLinkMessage({ companyName: "Nimbus", partySize: 40, eventDate: null, perHeadInr: null, url: "u" }), / on |standard/);
});
