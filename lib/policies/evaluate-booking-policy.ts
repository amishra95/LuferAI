/**
 * Pure corporate-policy rules, kept free of server/DB imports so they can be
 * unit-tested directly (tests/booking-policy.test.mjs). Data access lives in
 * checkBookingPolicy.ts.
 */

export interface BookingPolicyRules {
  /** Per-head cap, pre-GST. null = no cap. */
  max_budget_per_head: number | null;
  /** Booking total (pre-GST) above which sign-off is needed. null = never. */
  requires_approval_above: number | null;
  /** Booking total above which a tier-2 (senior) sign-off is needed too. null/absent = never. */
  high_value_threshold?: number | null;
}

export interface BookingPolicyInput {
  tenant_id: string;
  /** Pre-GST taxable value of the whole booking. */
  total_amount: number;
  headcount: number;
  per_head_amount: number;
}

export type BookingPolicyResult =
  | { requiresApproval: false }
  /** tiers: how many levels of the approval chain must sign off (2 = manager + senior). */
  | { requiresApproval: true; reason: string; tiers: 1 | 2 };

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

/** A tenant without a policy row (rules = null) never needs approval. */
export function evaluateBookingPolicy(
  rules: BookingPolicyRules | null,
  input: Pick<BookingPolicyInput, "total_amount" | "headcount" | "per_head_amount">
): BookingPolicyResult {
  if (!rules) return { requiresApproval: false };

  const reasons: string[] = [];
  if (rules.max_budget_per_head !== null && input.per_head_amount > Number(rules.max_budget_per_head)) {
    reasons.push(
      `${inr(input.per_head_amount)} per head exceeds the ${inr(Number(rules.max_budget_per_head))} per-head budget`
    );
  }
  if (rules.requires_approval_above !== null && input.total_amount > Number(rules.requires_approval_above)) {
    reasons.push(
      `${inr(input.total_amount)} total for ${input.headcount} guests is above the ${inr(Number(rules.requires_approval_above))} approval threshold`
    );
  }

  const highValue = rules.high_value_threshold != null && input.total_amount > Number(rules.high_value_threshold);
  if (highValue) {
    reasons.push(`it is above the ${inr(Number(rules.high_value_threshold))} high-value threshold, so it also needs senior sign-off`);
  }

  return reasons.length === 0
    ? { requiresApproval: false }
    : { requiresApproval: true, reason: reasons.join("; "), tiers: highValue ? 2 : 1 };
}
