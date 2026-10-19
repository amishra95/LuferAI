import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, diffStats, validatePromptDraft } from "../lib/ai/prompt-registry.ts";
import {
  DEFAULT_PLATFORM_GUARDRAILS,
  effectiveRules,
  engineLimits,
  escalationReason,
  parsePlatformGuardrails,
  platformAutoDecision,
  validatePlatformGuardrails,
} from "../lib/guardrails/platform.ts";
import { menuPackageRules, minimumSpendRules } from "../lib/guardrails/engine.ts";
import { checkOffer, NO_RULES } from "../lib/rfp/guardrails.ts";
import { createDatabase } from "./support/supabase-pglite.mjs";

const platform = (over = {}) => ({ ...DEFAULT_PLATFORM_GUARDRAILS, ...over });
const host = (over = {}) => ({ ...NO_RULES, ...over });

// --- prompt registry ----------------------------------------------------------------

test("validatePromptDraft normalises line endings and trailing spaces, and bounds length", () => {
  const ok = validatePromptDraft({ body: "  You are a revenue assistant.   \r\nBe brief and cite getVenueTerms.  \r\n", note: "  tone  " });
  assert.deepEqual(ok, { ok: true, value: { body: "You are a revenue assistant.\nBe brief and cite getVenueTerms.", note: "tone" } });
  assert.equal(validatePromptDraft({ body: "x".repeat(50), note: "" }).value.note, null);
  assert.match(validatePromptDraft({ body: "too short", note: "" }).error, /at least 40/);
  assert.match(validatePromptDraft({ body: "y".repeat(8001), note: "" }).error, /under 8,000/);
  assert.match(validatePromptDraft({ body: "z".repeat(60), note: "n".repeat(201) }).error, /change note/);
  assert.equal(validatePromptDraft({ body: 42, note: "" }).ok, false);
});

test("diffLines marks added, removed and unchanged lines with their numbers", () => {
  const before = "Role line\nPropose one change.\nBe brief.";
  const after = "Role line\nPropose at most one change per call.\nBe brief.\nNever discount below the floor.";
  const d = diffLines(before, after);
  assert.deepEqual(
    d.map((l) => `${l.type}:${l.text}`),
    ["same:Role line", "del:Propose one change.", "add:Propose at most one change per call.", "same:Be brief.", "add:Never discount below the floor."]
  );
  assert.deepEqual(diffStats(d), { added: 2, removed: 1 });
  assert.equal(d[3].oldLine, 3);
  assert.equal(d[3].newLine, 3);
  assert.deepEqual(diffStats(diffLines(before, before)), { added: 0, removed: 0 });
});

// --- platform guardrails: storage and validation -------------------------------------------

test("parsePlatformGuardrails falls back to defaults for missing or out-of-range values", () => {
  assert.deepEqual(parsePlatformGuardrails(null), DEFAULT_PLATFORM_GUARDRAILS);
  const p = parsePlatformGuardrails({ maxDiscountPct: 20, declineGapPct: null, escalateTotalInr: 5, allowAutoCounter: false, packageMinPerHeadInr: 9000, packageMaxPerHeadInr: 2000 });
  assert.equal(p.maxDiscountPct, 20);
  assert.equal(p.escalateTotalInr, null); // 5 is out of range: default (off)
  assert.equal(p.allowAutoCounter, false);
  assert.equal(p.packageMinPerHeadInr, DEFAULT_PLATFORM_GUARDRAILS.packageMinPerHeadInr); // inverted range: both reset
  assert.equal(parsePlatformGuardrails({ maxDiscountPct: 500 }).maxDiscountPct, DEFAULT_PLATFORM_GUARDRAILS.maxDiscountPct);
});

test("validatePlatformGuardrails checks every field, snaps to steps and catches contradictions", () => {
  const ok = validatePlatformGuardrails({ ...DEFAULT_PLATFORM_GUARDRAILS, maxDiscountPct: 25, escalateDiscountPct: 15, escalateTotalInr: 512_345 });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.escalateTotalInr, 510_000);
  assert.match(validatePlatformGuardrails({ ...DEFAULT_PLATFORM_GUARDRAILS, maxDiscountPct: 95 }).error, /Discount cap/);
  assert.match(validatePlatformGuardrails({ ...DEFAULT_PLATFORM_GUARDRAILS, maxDiscountPct: 10, escalateDiscountPct: 20 }).error, /never trigger/);
  assert.match(validatePlatformGuardrails({ ...DEFAULT_PLATFORM_GUARDRAILS, packageMinPerHeadInr: 5000, packageMaxPerHeadInr: 5000 }).error, /below the highest/);
  assert.equal(validatePlatformGuardrails({ ...DEFAULT_PLATFORM_GUARDRAILS, allowAutoDecline: "yes" }).ok, false);
  assert.equal(validatePlatformGuardrails({ ...DEFAULT_PLATFORM_GUARDRAILS, declineGapPct: undefined }).ok, false);
});

// --- platform guardrails: applied ---------------------------------------------------------

test("hosts' rules apply within the platform's ceilings", () => {
  assert.equal(effectiveRules(host({ maxDiscountPct: null }), platform({ maxDiscountPct: 20 })).maxDiscountPct, 20);
  assert.equal(effectiveRules(host({ maxDiscountPct: 10 }), platform({ maxDiscountPct: 20 })).maxDiscountPct, 10);
  assert.equal(effectiveRules(host({ maxDiscountPct: 40 }), platform({ maxDiscountPct: 20 })).maxDiscountPct, 20);
  const paused = effectiveRules(host({ minSpendFloor: 1, autoCounter: true, autoDeclineBelowFloor: true }), platform({ allowAutoCounter: false, allowAutoDecline: false }));
  assert.equal(paused.autoCounter, false);
  assert.equal(paused.autoDeclineBelowFloor, false);
  // A counter the host allows but the cap doesn't.
  assert.match(checkOffer(effectiveRules(host({ maxDiscountPct: 40 }), platform({ maxDiscountPct: 20 })), { perHead: 700, partySize: 10, standardPerHead: 1000 }), /ceiling is 20%/);
});

test("platformAutoDecision: auto-counter, escalation, the gap trigger and the switches", () => {
  const rules = host({ minSpendFloor: 10_000, maxDiscountPct: 30, autoCounter: true, autoDeclineBelowFloor: true });
  const rfp = { standardPerHead: 2000, partySize: 40, budgetPerHead: 1700 }; // 15% under
  assert.equal(platformAutoDecision(rules, platform(), rfp).action, "counter");
  const esc = platformAutoDecision(rules, platform({ escalateDiscountPct: 10 }), rfp);
  assert.equal(esc.action, "escalate");
  assert.match(esc.note, /15.0% off is past the 10% escalation threshold/);
  assert.equal(platformAutoDecision(rules, platform({ escalateTotalInr: 60_000 }), rfp).action, "escalate"); // ₹68,000
  assert.equal(platformAutoDecision(rules, platform({ declineGapPct: 10 }), rfp).action, "decline");
  assert.equal(platformAutoDecision(rules, platform({ declineGapPct: 10, allowAutoDecline: false }), rfp).action, "counter");
  assert.equal(platformAutoDecision(rules, platform({ allowAutoCounter: false }), rfp).action, "none");
  // The gap trigger only applies to venues that opted into auto-decline.
  assert.equal(platformAutoDecision({ ...rules, autoDeclineBelowFloor: false }, platform({ declineGapPct: 10 }), rfp).action, "counter");
});

test("escalationReason is null within both thresholds", () => {
  assert.equal(escalationReason(platform({ escalateDiscountPct: 20, escalateTotalInr: 100_000 }), { perHead: 1700, standardPerHead: 2000, partySize: 40 }), null);
});

test("the AI negotiator's limits come from the platform settings", () => {
  const limits = engineLimits(platform({ minSpendMaxChangePct: 20, packageMinPerHeadInr: 500, packageMaxPerHeadInr: 5000 }));
  assert.equal(minimumSpendRules({ min_spend_inr: 52_000, reason: "r" }, { current: 40_000 }, limits.minimumSpend).code, "change_too_large");
  assert.equal(minimumSpendRules({ min_spend_inr: 52_000, reason: "r" }, { current: 40_000 }).allowed, true); // default ±50%
  const pkg = { package_id: null, name: "Set", per_head_inr: 6000, dietary_tags: [], description: null, is_active: true, reason: "r" };
  assert.equal(menuPackageRules(pkg, { activePackageIds: [], packageExists: true }, limits.menuPackage).code, "price_out_of_range");
});

// --- migration 0028 -------------------------------------------------------------------------

test("activate_prompt_version keeps exactly one active version and allows rollback", async () => {
  const db = await createDatabase();
  const body = "You are a revenue assistant for a venue. Propose one change at a time.";
  const ids = [];
  for (const v of [1, 2]) {
    const { rows } = await db.query("insert into public.agent_prompt_versions (prompt_key, version, body) values ('property-negotiator', $1, $2) returning id", [v, `${body} v${v}`]);
    ids.push(rows[0].id);
  }
  const active = async () => (await db.query("select version from public.agent_prompt_versions where status = 'active'")).rows.map((r) => r.version);
  await db.query("select public.activate_prompt_version($1, null)", [ids[0]]);
  assert.deepEqual(await active(), [1]);
  await db.query("select public.activate_prompt_version($1, null)", [ids[1]]);
  assert.deepEqual(await active(), [2]);
  await db.query("select public.activate_prompt_version($1, null)", [ids[0]]); // roll back
  assert.deepEqual(await active(), [1]);
  // The partial unique index refuses a second active row however it's written.
  await assert.rejects(db.query("update public.agent_prompt_versions set status = 'active' where id = $1", [ids[1]]));
  await assert.rejects(db.query("insert into public.agent_prompt_versions (prompt_key, version, body) values ('property-negotiator', 2, $1)", [body]));
  await assert.rejects(db.query("insert into public.agent_prompt_versions (prompt_key, version, body) values ('property-negotiator', 3, 'short')"));
  await assert.rejects(db.query("select public.activate_prompt_version(gen_random_uuid(), null)"), /not found/);
});

test("platform_guardrail_settings holds a single JSON object row", async () => {
  const db = await createDatabase();
  await db.query(`insert into public.platform_guardrail_settings (settings) values ('{"maxDiscountPct": 20}')`);
  await assert.rejects(db.query(`insert into public.platform_guardrail_settings (id, settings) values (false, '{}')`));
  await assert.rejects(db.query(`insert into public.platform_guardrail_settings (settings) values ('{}')`)); // second row
  await assert.rejects(db.query(`update public.platform_guardrail_settings set settings = '[]'`));
});
