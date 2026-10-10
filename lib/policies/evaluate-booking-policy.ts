/**
 * Pure corporate-policy rules, kept free of server/DB imports so they can be
 * unit-tested directly (tests/booking-policy.test.mjs). Data access lives in
 * checkBookingPolicy.ts.
 */

export type AlcoholPolicy = "allowed" | "approval" | "prohibited";

export interface BookingPolicyRules {
  /** Per-head cap, pre-GST. null = no cap. */
  max_budget_per_head: number | null;
  /** Booking total (pre-GST) above which sign-off is needed. null = never. */
  requires_approval_above: number | null;
  /** Booking total above which a tier-2 (senior) sign-off is needed too. null/absent = never. */
  high_value_threshold?: number | null;
  /** allowed (default) · approval: alcohol needs sign-off · prohibited: never booked. */
  alcohol_policy?: AlcoholPolicy | string;
  /** Entertainment types that need sign-off, e.g. ["dj", "karaoke"]. */
  restricted_entertainment?: readonly string[];
}

/** The company-wide monthly limit (companies.monthly_spend_limit_inr; 0 = none) and what's committed so far. */
export interface SpendLimitInput {
  monthly_limit: number;
  /** Pre-GST total of the company's other non-cancelled bookings in the event's month. */
  month_to_date: number;
}

export interface BookingPolicyInput {
  tenant_id: string;
  /** Pre-GST taxable value of the whole booking. */
  total_amount: number;
  headcount: number;
  per_head_amount: number;
  /** YYYY-MM-DD; needed for the monthly spend limit. */
  event_date?: string;
  alcohol_included?: boolean;
  entertainment?: readonly string[];
}

export type BookingPolicyResult =
  | { requiresApproval: false; blocked?: false }
  /** tiers: how many levels of the approval chain must sign off (2 = manager + senior). */
  | { requiresApproval: true; reason: string; tiers: 1 | 2; blocked?: false }
  /** Against policy outright: no approval can allow it. */
  | { requiresApproval: false; blocked: true; reason: string };

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const LABEL: Record<string, string> = { live_music: "live music", dj: "a DJ", karaoke: "karaoke", comedy: "comedy", games: "games" };
const entertainmentLabel = (e: string) => LABEL[e] ?? e.replace(/_/g, " ");

/** Restricted entertainment this event includes. */
export function restrictedIn(rules: Pick<BookingPolicyRules, "restricted_entertainment"> | null, entertainment: readonly string[] = []): string[] {
  const restricted = new Set(rules?.restricted_entertainment ?? []);
  return [...new Set(entertainment)].filter((e) => restricted.has(e));
}

/**
 * The company's committed spend in a month (pre-GST), for the monthly limit:
 * every non-cancelled booking whose event falls in that month, except `excludeId`.
 */
export function monthToDateSpend(
  bookings: readonly { id: string; company_id: string; event_date: string; status: string; total_amount_inr: number }[],
  companyId: string,
  eventDate: string,
  excludeId?: string
): number {
  const month = eventDate.slice(0, 7);
  return bookings
    .filter((b) => b.company_id === companyId && b.id !== excludeId && b.status !== "CANCELLED" && b.event_date.slice(0, 7) === month)
    .reduce((sum, b) => sum + Number(b.total_amount_inr), 0);
}

/**
 * A tenant without a policy row (rules = null) never needs approval, except
 * for the company-wide monthly limit, which lives on the company.
 *
 * Order of severity: a prohibited item blocks outright; otherwise every breach
 * is listed and the strictest decides the tiers (the high-value threshold and
 * the monthly limit need senior sign-off).
 */
export function evaluateBookingPolicy(
  rules: BookingPolicyRules | null,
  input: Pick<BookingPolicyInput, "total_amount" | "headcount" | "per_head_amount" | "alcohol_included" | "entertainment">,
  spend: SpendLimitInput | null = null
): BookingPolicyResult {
  if (input.alcohol_included && rules?.alcohol_policy === "prohibited") {
    return { requiresApproval: false, blocked: true, reason: "company policy doesn't allow alcohol at company events" };
  }

  const reasons: string[] = [];
  let senior = false;

  if (spend && spend.monthly_limit > 0 && spend.month_to_date + input.total_amount > spend.monthly_limit) {
    senior = true;
    reasons.push(
      `it takes this month's committed spend to ${inr(spend.month_to_date + input.total_amount)}, over the company's ${inr(spend.monthly_limit)} monthly limit`
    );
  }
  if (!rules) return reasons.length ? { requiresApproval: true, reason: reasons.join("; "), tiers: 2 } : { requiresApproval: false };

  if (input.alcohol_included && rules.alcohol_policy === "approval") reasons.push("it includes alcohol, which needs sign-off under company policy");
  const restricted = restrictedIn(rules, input.entertainment);
  if (restricted.length) reasons.push(`it includes ${restricted.map(entertainmentLabel).join(" and ")}, which needs sign-off under company policy`);

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
    : { requiresApproval: true, reason: reasons.join("; "), tiers: highValue || senior ? 2 : 1 };
}

export interface PolicyCheck {
  rule: "per_head" | "approval_threshold" | "monthly_limit" | "alcohol" | "entertainment";
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
  input: Pick<BookingPolicyInput, "total_amount" | "per_head_amount" | "alcohol_included" | "entertainment">,
  spend: SpendLimitInput | null = null
): PolicyCheck[] {
  const checks: PolicyCheck[] = [];
  if (spend && spend.monthly_limit > 0) {
    const after = spend.month_to_date + input.total_amount;
    checks.push({
      rule: "monthly_limit",
      label: "Monthly spend limit",
      ok: after <= spend.monthly_limit,
      detail: `${inr(after)} committed this month vs ${inr(spend.monthly_limit)} limit`,
    });
  }
  if (!rules) return checks;
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
  if (input.alcohol_included !== undefined && rules.alcohol_policy && rules.alcohol_policy !== "allowed") {
    checks.push({
      rule: "alcohol",
      label: "Alcohol",
      ok: !input.alcohol_included,
      detail: input.alcohol_included ? `Included; policy: ${rules.alcohol_policy === "prohibited" ? "not allowed" : "needs sign-off"}` : "Not included",
    });
  }
  if (input.entertainment && rules.restricted_entertainment?.length) {
    const restricted = restrictedIn(rules, input.entertainment);
    checks.push({
      rule: "entertainment",
      label: "Entertainment",
      ok: restricted.length === 0,
      detail: restricted.length ? `Includes ${restricted.map(entertainmentLabel).join(", ")} (needs sign-off)` : "Nothing restricted",
    });
  }
  return checks;
}
