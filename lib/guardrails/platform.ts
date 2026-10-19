/**
 * Platform-wide guardrails admins tune on /agents (platform_guardrail_settings,
 * migration 0028). They are ceilings: each venue host's own rules
 * (lib/rfp/guardrails.ts) still apply, but only within them.
 *
 *   maxDiscountPct          no offer may go further below the venue's own price,
 *                           whatever the host allows
 *   allowAutoCounter /      switch hosts' auto-counter / auto-decline on or off
 *   allowAutoDecline        platform-wide
 *   declineGapPct           auto-decline trigger: for venues with auto-decline on,
 *                           also decline budgets more than this % under the
 *                           venue's price (null = only below the floor)
 *   escalateDiscountPct /   an automatic counter deeper than this, or above this
 *   escalateTotalInr        total, isn't sent: it waits for the host
 *   minSpendMaxChangePct,   the AI negotiator's limits per approved change
 *   packageMin/MaxPerHeadInr
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/prompt-guardrail-management.test.mjs).
 */
import { autoDecision, MAX_DISCOUNT_CAP, type AutoDecision, type NegotiationRules } from "../rfp/guardrails.ts";
import { GUARDRAIL_LIMITS } from "./schemas.ts";

export interface PlatformGuardrails {
  maxDiscountPct: number;
  allowAutoCounter: boolean;
  allowAutoDecline: boolean;
  declineGapPct: number | null;
  escalateDiscountPct: number | null;
  escalateTotalInr: number | null;
  minSpendMaxChangePct: number;
  packageMinPerHeadInr: number;
  packageMaxPerHeadInr: number;
}

/** Today's behaviour: the limits that were constants before they were tunable. */
export const DEFAULT_PLATFORM_GUARDRAILS: PlatformGuardrails = {
  maxDiscountPct: MAX_DISCOUNT_CAP,
  allowAutoCounter: true,
  allowAutoDecline: true,
  declineGapPct: null,
  escalateDiscountPct: null,
  escalateTotalInr: null,
  minSpendMaxChangePct: Math.round(GUARDRAIL_LIMITS.minimumSpend.maxChangeFraction * 100),
  packageMinPerHeadInr: GUARDRAIL_LIMITS.menuPackage.minPerHeadInr,
  packageMaxPerHeadInr: GUARDRAIL_LIMITS.menuPackage.maxPerHeadInr,
};

/** Slider ranges; also what validation enforces. */
export const PLATFORM_BOUNDS = {
  maxDiscountPct: { min: 0, max: MAX_DISCOUNT_CAP, step: 1 },
  declineGapPct: { min: 5, max: 90, step: 1 },
  escalateDiscountPct: { min: 1, max: MAX_DISCOUNT_CAP, step: 1 },
  escalateTotalInr: { min: 10_000, max: 10_000_000, step: 10_000 },
  minSpendMaxChangePct: { min: 5, max: 100, step: 5 },
  packageMinPerHeadInr: { min: 100, max: 10_000, step: 50 },
  packageMaxPerHeadInr: { min: 1_000, max: 100_000, step: 500 },
} as const;

type NumberKey = keyof typeof PLATFORM_BOUNDS;
const NULLABLE: ReadonlySet<NumberKey> = new Set(["declineGapPct", "escalateDiscountPct", "escalateTotalInr"]);

const LABEL: Record<NumberKey, string> = {
  maxDiscountPct: "Discount cap",
  declineGapPct: "Auto-decline gap",
  escalateDiscountPct: "Escalation discount",
  escalateTotalInr: "Escalation total",
  minSpendMaxChangePct: "AI minimum-spend change limit",
  packageMinPerHeadInr: "Lowest package price",
  packageMaxPerHeadInr: "Highest package price",
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const inBounds = (key: NumberKey, v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= PLATFORM_BOUNDS[key].min && v <= PLATFORM_BOUNDS[key].max;

/** Stored JSON → settings. Anything missing or out of range falls back to the default, so a bad row can't loosen a limit. */
export function parsePlatformGuardrails(raw: unknown): PlatformGuardrails {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: PlatformGuardrails = { ...DEFAULT_PLATFORM_GUARDRAILS };
  for (const key of Object.keys(PLATFORM_BOUNDS) as NumberKey[]) {
    if (NULLABLE.has(key) && o[key] === null) (out as unknown as Record<string, unknown>)[key] = null;
    else if (inBounds(key, o[key])) (out as unknown as Record<string, unknown>)[key] = o[key];
  }
  if (typeof o.allowAutoCounter === "boolean") out.allowAutoCounter = o.allowAutoCounter;
  if (typeof o.allowAutoDecline === "boolean") out.allowAutoDecline = o.allowAutoDecline;
  if (out.packageMinPerHeadInr >= out.packageMaxPerHeadInr) {
    out.packageMinPerHeadInr = DEFAULT_PLATFORM_GUARDRAILS.packageMinPerHeadInr;
    out.packageMaxPerHeadInr = DEFAULT_PLATFORM_GUARDRAILS.packageMaxPerHeadInr;
  }
  return out;
}

/** The tuning panel's submission: every field present, nullable ones may be null (switched off). */
export function validatePlatformGuardrails(input: Record<string, unknown>): Result<PlatformGuardrails> {
  const value = { ...DEFAULT_PLATFORM_GUARDRAILS };
  for (const key of Object.keys(PLATFORM_BOUNDS) as NumberKey[]) {
    const v = input[key];
    if (v === null && NULLABLE.has(key)) {
      (value as unknown as Record<string, unknown>)[key] = null;
      continue;
    }
    if (!inBounds(key, v)) {
      const b = PLATFORM_BOUNDS[key];
      return { ok: false, error: `${LABEL[key]} must be between ${b.min.toLocaleString("en-IN")} and ${b.max.toLocaleString("en-IN")}.` };
    }
    (value as unknown as Record<string, unknown>)[key] = Math.round(v / PLATFORM_BOUNDS[key].step) * PLATFORM_BOUNDS[key].step;
  }
  for (const key of ["allowAutoCounter", "allowAutoDecline"] as const) {
    if (typeof input[key] !== "boolean") return { ok: false, error: `${key} must be on or off.` };
    value[key] = input[key] as boolean;
  }
  if (value.packageMinPerHeadInr >= value.packageMaxPerHeadInr) return { ok: false, error: "The lowest package price must be below the highest." };
  if (value.escalateDiscountPct !== null && value.escalateDiscountPct > value.maxDiscountPct) {
    return { ok: false, error: `Escalating at ${value.escalateDiscountPct}% off would never trigger: the discount cap stops offers at ${value.maxDiscountPct}%.` };
  }
  return { ok: true, value };
}

/** A host's rules within the platform's ceilings. */
export function effectiveRules(host: NegotiationRules, platform: PlatformGuardrails): NegotiationRules {
  return {
    ...host,
    maxDiscountPct: Math.min(host.maxDiscountPct ?? platform.maxDiscountPct, platform.maxDiscountPct),
    autoCounter: host.autoCounter && platform.allowAutoCounter,
    autoDeclineBelowFloor: host.autoDeclineBelowFloor && platform.allowAutoDecline,
  };
}

/** The AI negotiator's limits (lib/guardrails/engine.ts takes them as `limits`). */
export function engineLimits(platform: PlatformGuardrails) {
  return {
    minimumSpend: { maxChangeFraction: platform.minSpendMaxChangePct / 100 },
    menuPackage: { minPerHeadInr: platform.packageMinPerHeadInr, maxPerHeadInr: platform.packageMaxPerHeadInr },
  };
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Why an automatic offer should wait for a person, or null to send it. */
export function escalationReason(platform: PlatformGuardrails, offer: { perHead: number; standardPerHead: number; partySize: number }): string | null {
  const discount = offer.standardPerHead > 0 ? (1 - offer.perHead / offer.standardPerHead) * 100 : 0;
  if (platform.escalateDiscountPct !== null && discount > platform.escalateDiscountPct + 1e-9) {
    return `${discount.toFixed(1)}% off is past the ${platform.escalateDiscountPct}% escalation threshold`;
  }
  const total = offer.perHead * offer.partySize;
  if (platform.escalateTotalInr !== null && total > platform.escalateTotalInr) {
    return `${inr(total)} is above the ${inr(platform.escalateTotalInr)} escalation threshold`;
  }
  return null;
}

export type PlatformAutoDecision = AutoDecision | { action: "escalate"; perHead: number; note: string };

/**
 * What happens to a fresh over-budget RFP at one venue: the host's auto rules
 * within the platform's, the platform's decline trigger, and escalation of
 * automatic counters past the thresholds.
 */
export function platformAutoDecision(
  host: NegotiationRules,
  platform: PlatformGuardrails,
  rfp: { standardPerHead: number; partySize: number; budgetPerHead: number | null }
): PlatformAutoDecision {
  const rules = effectiveRules(host, platform);
  const budget = rfp.budgetPerHead;
  if (rules.autoDeclineBelowFloor && platform.declineGapPct !== null && budget != null && budget > 0 && budget < rfp.standardPerHead) {
    const gap = (1 - budget / rfp.standardPerHead) * 100;
    if (gap > platform.declineGapPct + 1e-9) {
      return { action: "decline", note: `Declined automatically: ${inr(budget)} a head is ${gap.toFixed(0)}% under the venue's ${inr(rfp.standardPerHead)}.` };
    }
  }
  const decision = autoDecision(rules, rfp);
  if (decision.action !== "counter") return decision;
  const reason = escalationReason(platform, { perHead: decision.perHead, standardPerHead: rfp.standardPerHead, partySize: rfp.partySize });
  return reason ? { action: "escalate", perHead: decision.perHead, note: `Escalated to the host: an automatic counter at ${inr(decision.perHead)} a head ${reason}.` } : decision;
}
