/**
 * A venue's negotiation guardrails (venue_negotiation_rules, migration 0025):
 * a minimum spend floor and a maximum discount off the venue's own price,
 * enforced on manual counters, direct quotes and the AI negotiator; plus the
 * optional auto-counter and auto-decline applied when an RFP is broadcast.
 *
 * Pure, with no path aliases, so tests can import it directly
 * (tests/venue-host-controls.test.mjs).
 */

export interface NegotiationRules {
  /** Pre-GST total an offer may not go below; null = no floor. */
  minSpendFloor: number | null;
  /** Largest discount (percent) off the venue's own per-head price; null = no cap. */
  maxDiscountPct: number | null;
  /** Counter over-budget RFPs that fit within the guardrails, at the client's budget. */
  autoCounter: boolean;
  /** Decline RFPs whose budget can't reach the floor. */
  autoDeclineBelowFloor: boolean;
}

export const NO_RULES: NegotiationRules = { minSpendFloor: null, maxDiscountPct: null, autoCounter: false, autoDeclineBelowFloor: false };

export const MAX_DISCOUNT_CAP = 90;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export type RulesResult = { ok: true; value: NegotiationRules } | { ok: false; error: string };

/** Validates the drawer's form (strings from inputs, blank = none). */
export function parseRules(input: { minSpendFloor: string; maxDiscountPct: string; autoCounter: boolean; autoDeclineBelowFloor: boolean }): RulesResult {
  const floorText = input.minSpendFloor.trim().replace(/[₹,\s]/g, "");
  const pctText = input.maxDiscountPct.trim().replace(/[%\s]/g, "");
  const floor = floorText === "" ? null : Number(floorText);
  const pct = pctText === "" ? null : Number(pctText);
  if (floor !== null && !(Number.isFinite(floor) && floor >= 0)) return { ok: false, error: "The minimum spend floor must be a positive amount, or blank for none." };
  if (pct !== null && !(Number.isFinite(pct) && pct >= 0 && pct <= MAX_DISCOUNT_CAP)) {
    return { ok: false, error: `The maximum discount must be between 0 and ${MAX_DISCOUNT_CAP}%, or blank for none.` };
  }
  if (input.autoDeclineBelowFloor && floor === null) return { ok: false, error: "Set a minimum spend floor to auto-decline below it." };
  if (input.autoCounter && floor === null && pct === null) return { ok: false, error: "Set a floor or a maximum discount for auto-counter to work within." };
  return {
    ok: true,
    value: {
      minSpendFloor: floor === null ? null : Math.round(floor),
      maxDiscountPct: pct === null ? null : Math.round(pct * 100) / 100,
      autoCounter: input.autoCounter,
      autoDeclineBelowFloor: input.autoDeclineBelowFloor,
    },
  };
}

/** The lowest per-head price the guardrails allow, rounded up to the rupee (0 when nothing binds). */
export function lowestAllowedPerHead(rules: NegotiationRules, standardPerHead: number | null, partySize: number): number {
  const byDiscount = standardPerHead != null && rules.maxDiscountPct != null ? standardPerHead * (1 - rules.maxDiscountPct / 100) : 0;
  const byFloor = rules.minSpendFloor != null && partySize > 0 ? rules.minSpendFloor / partySize : 0;
  return Math.max(0, Math.ceil(Math.max(byDiscount, byFloor) - 1e-9));
}

/**
 * Why an offer breaks the guardrails, or null when it's allowed. `standardPerHead`
 * is the venue's own price it's discounted from (the instant quote or the
 * package); without one the discount ceiling can't apply.
 */
export function checkOffer(rules: NegotiationRules, offer: { perHead: number; partySize: number; standardPerHead: number | null }): string | null {
  const total = offer.perHead * offer.partySize;
  if (rules.minSpendFloor != null && total < rules.minSpendFloor) {
    return `${inr(total)} for ${offer.partySize} guests is below your ${inr(rules.minSpendFloor)} minimum spend floor (at least ${inr(Math.ceil(rules.minSpendFloor / offer.partySize))} a head).`;
  }
  if (rules.maxDiscountPct != null && offer.standardPerHead != null && offer.standardPerHead > 0) {
    const discount = (1 - offer.perHead / offer.standardPerHead) * 100;
    if (discount > rules.maxDiscountPct + 1e-9) {
      return `That's ${discount.toFixed(1)}% off your ${inr(offer.standardPerHead)} a head; your ceiling is ${rules.maxDiscountPct}% (at least ${inr(Math.ceil(offer.standardPerHead * (1 - rules.maxDiscountPct / 100)))} a head).`;
    }
  }
  return null;
}

export type AutoDecision = { action: "none" } | { action: "counter"; perHead: number; note: string } | { action: "decline"; note: string };

/**
 * What the guardrails do with a fresh RFP whose instant quote is over the
 * client's budget. Within the guardrails: counter at the budget (never lower
 * than the client asked). Below the floor: decline, if switched on.
 * Otherwise leave the instant quote for the host.
 */
export function autoDecision(rules: NegotiationRules, rfp: { standardPerHead: number; partySize: number; budgetPerHead: number | null }): AutoDecision {
  if (!rules.autoCounter && !rules.autoDeclineBelowFloor) return { action: "none" };
  if (rfp.budgetPerHead == null || rfp.budgetPerHead <= 0 || rfp.budgetPerHead >= rfp.standardPerHead) return { action: "none" };
  const budget = Math.floor(rfp.budgetPerHead);
  if (rules.autoDeclineBelowFloor && rules.minSpendFloor != null && budget * rfp.partySize < rules.minSpendFloor) {
    return { action: "decline", note: `Declined automatically: ${inr(budget * rfp.partySize)} is below the venue's minimum spend.` };
  }
  if (rules.autoCounter && checkOffer(rules, { perHead: budget, partySize: rfp.partySize, standardPerHead: rfp.standardPerHead }) === null) {
    return { action: "counter", perHead: budget, note: `Countered automatically at your budget of ${inr(budget)} a head.` };
  }
  return { action: "none" };
}
