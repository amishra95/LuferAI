import { test } from "node:test";
import assert from "node:assert/strict";
import {
  depositRateFor,
  describeMultiplier,
  multiplierFor,
  NO_PRICING,
  parseCancellationRows,
  parseDepositPct,
  parseGuestTiers,
  parseMultiplierForm,
  parseRateMultipliers,
  parseTierRows,
  priceFor,
  tierFor,
} from "../lib/rates/venue-pricing.ts";
import { autoDecision, checkOffer, NO_RULES } from "../lib/rfp/guardrails.ts";
import { menuPackageRules, minimumSpendRules } from "../lib/guardrails/engine.ts";
import { buildComparisonMatrix, DEPOSIT_RATE, priceQuote, quoteVenue } from "../lib/quotes.ts";
import { createDatabase } from "./support/supabase-pglite.mjs";

const weekend = { id: "w", kind: "weekend", label: "Weekend surcharge", weekdays: [5, 6], starts_on: null, ends_on: null, multiplier: 1.2 };
const peak = { id: "p", kind: "peak_season", label: "Wedding season", weekdays: [], starts_on: "2026-11-15", ends_on: "2026-12-15", multiplier: 1.5 };
const lull = { id: "l", kind: "high_demand", label: "Monsoon lull", weekdays: [], starts_on: "2026-07-01", ends_on: "2026-07-31", multiplier: 0.9 };
const tiers = [
  { min_guests: 1, max_guests: 40, adjustment_pct: 0 },
  { min_guests: 41, max_guests: 100, adjustment_pct: -5 },
  { min_guests: 101, max_guests: null, adjustment_pct: -10 },
];

// --- guest-count tiers ---------------------------------------------------------

test("parseTierRows reads bands, ignores blank rows and sorts them", () => {
  const r = parseTierRows([
    { min: "101", max: "", pct: "-10" },
    { min: "", max: "", pct: "" },
    { min: "41", max: "100", pct: "-5%" },
  ]);
  assert.deepEqual(r, {
    ok: true,
    value: [
      { min_guests: 41, max_guests: 100, adjustment_pct: -5 },
      { min_guests: 101, max_guests: null, adjustment_pct: -10 },
    ],
  });
});

test("parseTierRows refuses overlaps, open bands followed by more, and bad values", () => {
  assert.match(parseTierRows([{ min: "10", max: "50", pct: "0" }, { min: "40", max: "80", pct: "-5" }]).error, /overlap/);
  assert.match(parseTierRows([{ min: "10", max: "", pct: "0" }, { min: "40", max: "80", pct: "-5" }]).error, /overlap/);
  assert.match(parseTierRows([{ min: "0", max: "", pct: "0" }]).error, /smallest party size/);
  assert.match(parseTierRows([{ min: "50", max: "20", pct: "0" }]).error, /at least 50/);
  assert.match(parseTierRows([{ min: "10", max: "", pct: "-60" }]).error, /between -50% and \+100%/);
  assert.match(parseTierRows([{ min: "10", max: "", pct: "" }]).error, /adjustment/);
});

test("tierFor finds the band for a party size, or none", () => {
  assert.equal(tierFor(tiers, 40).adjustment_pct, 0);
  assert.equal(tierFor(tiers, 41).adjustment_pct, -5);
  assert.equal(tierFor(tiers, 5000).adjustment_pct, -10);
  assert.equal(tierFor([{ min_guests: 20, max_guests: 30, adjustment_pct: 5 }], 10), null);
});

// --- rate calendar ---------------------------------------------------------------

test("parseMultiplierForm builds weekend and date-range rates and validates them", () => {
  const w = parseMultiplierForm({ kind: "weekend", label: "", weekdays: ["6", "5", "5", "9"], startsOn: "", endsOn: "", multiplier: "×1.2" }, "id1");
  assert.deepEqual(w, { ok: true, value: { id: "id1", kind: "weekend", label: "Weekend surcharge", weekdays: [5, 6], starts_on: null, ends_on: null, multiplier: 1.2 } });
  const d = parseMultiplierForm({ kind: "high_demand", label: " NYE ", weekdays: [], startsOn: "2026-12-31", endsOn: "", multiplier: "2" }, "id2");
  assert.deepEqual(d.value, { id: "id2", kind: "high_demand", label: "NYE", weekdays: [], starts_on: "2026-12-31", ends_on: "2026-12-31", multiplier: 2 });
  assert.equal(parseMultiplierForm({ kind: "weekend", label: "", weekdays: [], startsOn: "", endsOn: "", multiplier: "1.2" }, "x").ok, false);
  assert.equal(parseMultiplierForm({ kind: "peak_season", label: "", weekdays: [], startsOn: "2026-12-10", endsOn: "2026-12-01", multiplier: "1.2" }, "x").ok, false);
  assert.equal(parseMultiplierForm({ kind: "peak_season", label: "", weekdays: [], startsOn: "2026-01-01", endsOn: "2027-06-01", multiplier: "1.2" }, "x").ok, false);
  assert.match(parseMultiplierForm({ kind: "weekend", label: "", weekdays: ["6"], startsOn: "", endsOn: "", multiplier: "4" }, "x").error, /between ×0.5 and ×3/);
  assert.equal(parseMultiplierForm({ kind: "holiday", label: "", weekdays: [], startsOn: "", endsOn: "", multiplier: "1" }, "x").ok, false);
});

test("multiplierFor applies the largest rate in force; discounts only when nothing raises it", () => {
  const all = [weekend, peak, lull];
  assert.deepEqual(multiplierFor(all, "2026-10-21"), { multiplier: 1, rule: null }); // Wednesday
  assert.equal(multiplierFor(all, "2026-10-23").rule.id, "w"); // Friday
  assert.equal(multiplierFor(all, "2026-11-20").multiplier, 1.5); // peak-season Friday: 1.5, not 1.8
  assert.equal(multiplierFor(all, "2026-07-08").multiplier, 0.9); // Wednesday in the lull
  assert.equal(multiplierFor(all, "2026-07-10").multiplier, 1.2); // Friday in the lull: surcharge wins
  assert.equal(multiplierFor(all, null).multiplier, 1);
});

test("stored lists are parsed defensively", () => {
  assert.deepEqual(parseRateMultipliers([weekend, { ...peak, ends_on: "2026-01-01" }, { id: 1 }, null, { ...weekend, id: "w2", weekdays: [] }]), [weekend]);
  assert.deepEqual(parseGuestTiers([{ min_guests: 0, max_guests: null, adjustment_pct: 1 }, ...tiers.slice().reverse()]), tiers);
  assert.deepEqual(parseGuestTiers("nope"), []);
});

test("describeMultiplier reads days or the date range", () => {
  assert.equal(describeMultiplier(weekend), "Fri, Sat ×1.2");
  assert.match(describeMultiplier(peak), /15 Nov 2026 – 15 Dec 2026 ×1.5/);
});

// --- price for one event ------------------------------------------------------------

test("priceFor applies the tier and the calendar rate to a package's list price", () => {
  const pricing = { tiers, multipliers: [weekend, peak] };
  const p = priceFor(2000, { partySize: 60, date: "2026-11-20" }, pricing);
  assert.equal(p.perHead, 2850); // 2000 × 0.95 × 1.5
  assert.equal(p.note, "Wedding season ×1.5 · 41–100 guests −5%");
  assert.deepEqual(priceFor(2000, { partySize: 20, date: "2026-10-21" }, pricing), { perHead: 2000, listPerHead: 2000, tier: tiers[0], multiplier: 1, rule: null, note: null });
  assert.equal(priceFor(1999, { partySize: 20, date: "2026-10-23" }, NO_PRICING).perHead, 1999);
});

test("an instant quote picks packages at the venue's price for the date and party", () => {
  const pricing = { tiers, multipliers: [weekend] };
  const venue = { id: "v", name: "V", gstin: "29AADCC1904P1ZF", capacity_max: 200, min_spend_inr: 0, pdr_available: true };
  const list = [
    { id: "a", name: "Classic", per_head_inr: 1500, dietary_tags: [], is_active: true },
    { id: "b", name: "Premium", per_head_inr: 2000, dietary_tags: [], is_active: true },
  ];
  const req = { partySize: 30, budgetPerHead: 2000, dietary: [], requiresPdr: false, rateCard: null, companyGstin: "29AABCN4821K1ZA" };
  // Weekday: Premium fits the ₹2,000 budget. Friday: Premium is ₹2,400, so Classic (₹1,800) is quoted.
  const at = (date) => list.map((p) => ({ ...p, per_head_inr: priceFor(p.per_head_inr, { partySize: 30, date }, pricing).perHead }));
  assert.equal(quoteVenue(venue, at("2026-10-21"), req).menu_package_id, "b");
  const friday = quoteVenue(venue, at("2026-10-23"), req);
  assert.equal(friday.menu_package_id, "a");
  assert.equal(friday.per_head_inr, 1800);
});

test("auto-counter and the discount ceiling are measured from the venue's own price for the date", () => {
  const rules = { ...NO_RULES, maxDiscountPct: 10, autoCounter: true };
  const own = priceFor(2000, { partySize: 30, date: "2026-11-20" }, { tiers: [], multipliers: [peak] }).perHead; // ₹3,000 in peak season
  assert.deepEqual(autoDecision(rules, { standardPerHead: own, partySize: 30, budgetPerHead: 2800 }), { action: "counter", perHead: 2800, note: "Countered automatically at your budget of ₹2,800 a head." });
  // ₹2,000 would be 33% off the peak price: refused, though it's the off-peak list price.
  assert.match(checkOffer(rules, { perHead: 2000, partySize: 30, standardPerHead: own }), /33.3% off/);
});

// --- deposit + cancellation ------------------------------------------------------------

test("deposits default to the platform rate; a venue may set 1–100%", () => {
  assert.equal(depositRateFor(null), DEPOSIT_RATE);
  assert.equal(depositRateFor({ depositPct: null }), DEPOSIT_RATE);
  assert.equal(depositRateFor({ depositPct: 40 }), 0.4);
  assert.deepEqual(parseDepositPct(" "), { ok: true, value: null });
  assert.deepEqual(parseDepositPct("12.5%"), { ok: true, value: 12.5 });
  assert.equal(parseDepositPct("0").ok, false); // payments.deposit_rate must be positive
  assert.equal(parseDepositPct("101").ok, false);
});

test("parseCancellationRows sorts by notice and refuses refunds that grow as notice shrinks", () => {
  assert.deepEqual(parseCancellationRows([{ days: "7", pct: "50" }, { days: "", pct: "" }, { days: "14", pct: "100" }]), {
    ok: true,
    value: [
      { days_before: 14, refund_pct: 100 },
      { days_before: 7, refund_pct: 50 },
    ],
  });
  assert.match(parseCancellationRows([{ days: "14", pct: "50" }, { days: "7", pct: "100" }]).error, /can't refund more/);
  assert.match(parseCancellationRows([{ days: "7", pct: "50" }, { days: "7", pct: "20" }]).error, /Two rules/);
  assert.equal(parseCancellationRows([{ days: "-1", pct: "50" }]).ok, false);
  assert.deepEqual(parseCancellationRows([]), { ok: true, value: [] });
});

test("the comparison matrix shows each venue's own deposit when one differs", () => {
  const col = (name, total, rate) => ({
    venue: { name, neighborhood: "Indiranagar", capacity_max: 50, pdr_available: true },
    status: "quoted",
    package_name: "Set",
    per_head_inr: 1000,
    price: priceQuote({ listAmount: total, taxableValue: total, companyGstin: "29AABCN4821K1ZA", venueGstin: "29AADCC1904P1ZF" }),
    notes: null,
    ...(rate === undefined ? {} : { deposit_rate: rate }),
  });
  const rfp = { party_size: 10, budget_per_head_inr: null, dietary_tags: [], event_date: null, city: null };
  assert.match(buildComparisonMatrix(rfp, [col("A", 10000), col("B", 20000)]), /\| Deposit \(25%\) \| ₹2,950 \| ₹5,900 \|/);
  assert.match(buildComparisonMatrix(rfp, [col("A", 10000), col("B", 20000, 0.4)]), /\| Deposit \| ₹2,950 \| ₹9,440 \(40%\) \|/);
});

// --- host locks on the AI negotiator ----------------------------------------------------

test("the AI negotiator can't change a locked minimum spend or package", () => {
  const spend = minimumSpendRules({ min_spend_inr: 45000, reason: "r" }, { current: 40000, floor: null, locked: true });
  assert.equal(spend.allowed, false);
  assert.equal(spend.code, "host_locked");
  assert.equal(minimumSpendRules({ min_spend_inr: 45000, reason: "r" }, { current: 40000 }).allowed, true);

  const pkg = { package_id: "11111111-1111-4111-8111-111111111111", name: "Set", per_head_inr: 2000, dietary_tags: [], description: null, is_active: true, reason: "r" };
  const ctx = { activePackageIds: [pkg.package_id], packageExists: true };
  assert.equal(menuPackageRules(pkg, { ...ctx, lockedPackageIds: [pkg.package_id] }).code, "host_locked");
  assert.equal(menuPackageRules({ ...pkg, package_id: null }, { ...ctx, lockedPackageIds: [pkg.package_id] }).allowed, true); // new packages are fine
  assert.equal(menuPackageRules(pkg, ctx).allowed, true); // the host's own edits pass no locks
});

// --- migration 0027 ------------------------------------------------------------------

test("venue_pricing_rules accepts a venue's rules and enforces the deposit range and list shapes", async () => {
  const db = await createDatabase();
  const {
    rows: [venue],
  } = await db.query("select id from public.venues limit 1");
  await db.query(`insert into public.venue_pricing_rules (venue_id, deposit_pct, guest_tiers) values ($1, 40, '[{"min_guests":1,"max_guests":null,"adjustment_pct":0}]')`, [venue.id]);
  const {
    rows: [row],
  } = await db.query("select lock_min_spend, locked_package_ids, rate_multipliers from public.venue_pricing_rules where venue_id = $1", [venue.id]);
  assert.deepEqual(row, { lock_min_spend: false, locked_package_ids: [], rate_multipliers: [] });
  await assert.rejects(db.query("update public.venue_pricing_rules set deposit_pct = 0 where venue_id = $1", [venue.id]));
  await assert.rejects(db.query("update public.venue_pricing_rules set rate_multipliers = '{}' where venue_id = $1", [venue.id]));
});
