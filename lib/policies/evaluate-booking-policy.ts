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

export interface PolicyCheck {
  rule: "per_head" | "approval_threshold";
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * The same two rules as evaluateBookingPolicy, one line each, for itemised
 * display (e.g. /client/approvals). Unset limits are omitted, not "passed".
 */
export function describePolicyChecks(
  rules: BookingPolicyRules | null,
  input: Pick<BookingPolicyInput, "total_amount" | "per_head_amount">
): PolicyCheck[] {
  if (!rules) return [];
  const checks: PolicyCheck[] = [];
  if (rules.max_budget_per_head !== null) {
    const cap = Number(rules.max_budget_per_head);
    checks.push({
      rule: "per_head",
      label: "Per-head budget",
      ok: input.per_head_amount <= cap,
      detail: `${inr(input.per_head_amount)} per head vs ${inr(cap)} cap`,
    });
  }
  if (rules.requires_approval_above !== null) {
    const threshold = Number(rules.requires_approval_above);
    checks.push({
      rule: "approval_threshold",
      label: "Approval threshold",
      ok: input.total_amount <= threshold,
      detail: `${inr(input.total_amount)} vs ${inr(threshold)} threshold`,
    });
  }
  return checks;
}
