/**
 * Pure corporate-policy rules, kept free of server/DB imports so they can be
 * unit-tested directly (tests/booking-policy.test.mjs). Data access lives in
 * checkBookingPolicy.ts.
 */

export type AlcoholPolicy = "allowed" | "approval" | "prohibited";

/** What kind of event it is (bookings.event_type / rfps.event_type, migration 20261031120000). */
export const EVENT_TYPES = {
  team_meal: "Team lunch / dinner",
  client_entertainment: "Client entertainment",
  offsite: "Offsite",
  celebration: "Celebration",
  town_hall: "Town hall",
  workshop: "Workshop / training",
  other: "Other",
} as const;
export type EventType = keyof typeof EVENT_TYPES;
export const isEventType = (v: unknown): v is EventType => typeof v === "string" && Object.hasOwn(EVENT_TYPES, v);

/**
 * The outcome stored on bookings and RFPs: manager = approval tier 1,
 * CFO = tier 2 (the approval chain's senior level).
 */
export const POLICY_STATUSES = ["in_policy", "requires_manager", "requires_cfo", "out_of_policy"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** Machine-readable rule codes (bookings.policy_violation_reasons). */
export type PolicyViolationCode =
  | "EXCEEDS_PER_HEAD_CAP"
  | "PER_HEAD_MANAGER_TIER"
  | "PER_HEAD_CFO_TIER"
  | "ABOVE_APPROVAL_THRESHOLD"
  | "ABOVE_HIGH_VALUE_THRESHOLD"
  | "OVER_MONTHLY_LIMIT"
  | "DEPARTMENT_PER_HEAD_CAP"
  | "DEPARTMENT_SENIOR_THRESHOLD"
  | "ALCOHOL_NEEDS_APPROVAL"
  | "ALCOHOL_PROHIBITED"
  | "RESTRICTED_ENTERTAINMENT"
  | "OPEN_BAR_WEEKDAY"
  | "RESTRICTED_EVENT_TYPE"
  | "OUTSIDE_EVENT_HOURS"
  | "BEYOND_OFFICE_DISTANCE";

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
  /** Per head up to which no sign-off is needed. null/absent = no per-head tiers. */
  auto_approval_limit_per_head?: number | null;
  /** Per head up to which manager sign-off suffices; above it, CFO. null/absent = no CFO tier. */
  manager_approval_limit_per_head?: number | null;
  /** Venues farther than this from the office need sign-off. */
  max_office_distance_km?: number | null;
  /** "HH:MM[:SS]"; events starting outside the window (which may wrap midnight) need sign-off. */
  event_hours_start?: string | null;
  event_hours_end?: string | null;
  /** Alcohol at a Monday–Friday event. */
  weekday_open_bar_policy?: AlcoholPolicy | string;
  /** Event types that need sign-off. */
  restricted_event_types?: readonly string[];
}

/** A department's own limits (department_policies, migration 0033); the stricter of these and the company's apply. */
export interface DepartmentPolicyRules {
  name: string;
  /** Per-head cap, pre-GST. null = company rule only. */
  max_budget_per_head: number | null;
  /** Booking total (pre-GST) above which senior (tier 2) sign-off is needed. null = company rule only. */
  senior_approval_above: number | null;
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
  /** The department charged, for its own limits (department_policies). */
  department_id?: string | null;
  /** What headcount counts, for the wording ("guests" by default; "gifts", "tickets"… for catalogue orders). */
  unit?: string;
  event_type?: EventType | null;
  /** "HH:MM", if known. */
  event_start_time?: string | null;
  /** Straight-line km from the company office to the venue, if both are known. */
  distance_from_office_km?: number | null;
}

export type BookingPolicyResult =
  | { requiresApproval: false; blocked?: false; codes?: [] }
  /** tiers: how many levels of the approval chain must sign off (2 = manager + senior). */
  | { requiresApproval: true; reason: string; tiers: 1 | 2; blocked?: false; codes: PolicyViolationCode[] }
  /** Against policy outright: no approval can allow it. */
  | { requiresApproval: false; blocked: true; reason: string; codes: PolicyViolationCode[] };

/** The stored outcome of an evaluation. */
export function policyStatusOf(result: BookingPolicyResult): PolicyStatus {
  if (result.blocked) return "out_of_policy";
  if (!result.requiresApproval) return "in_policy";
  return result.tiers === 2 ? "requires_cfo" : "requires_manager";
}

/** bookings / rfps columns for an evaluation. */
export function policyMetadata(result: BookingPolicyResult): { policy_status: PolicyStatus; policy_violation_reasons: PolicyViolationCode[] } {
  return { policy_status: policyStatusOf(result), policy_violation_reasons: result.codes ?? [] };
}

const hhmm = (t: string) => t.slice(0, 5);

/** Whether "HH:MM" falls in [start, end]; a window with end < start wraps midnight (e.g. 18:00–01:00). */
export function withinEventHours(time: string, start: string, end: string): boolean {
  const [t, s, e] = [hhmm(time), hhmm(start), hhmm(end)];
  return s <= e ? t >= s && t <= e : t >= s || t <= e;
}

const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The weekday name of a YYYY-MM-DD date if it falls Monday–Friday, else null. */
export function weekdayOf(date: string | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5 ? WEEKDAY_NAME[day] : null;
}

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
  input: Pick<
    BookingPolicyInput,
    "total_amount" | "headcount" | "per_head_amount" | "alcohol_included" | "entertainment" | "unit" | "event_date" | "event_type" | "event_start_time" | "distance_from_office_km"
  >,
  spend: SpendLimitInput | null = null,
  department: DepartmentPolicyRules | null = null
): BookingPolicyResult {
  if (input.alcohol_included && rules?.alcohol_policy === "prohibited") {
    return { requiresApproval: false, blocked: true, reason: "company policy doesn't allow alcohol at company events", codes: ["ALCOHOL_PROHIBITED"] };
  }
  const weekday = input.alcohol_included ? weekdayOf(input.event_date) : null;
  if (weekday && rules?.weekday_open_bar_policy === "prohibited") {
    return { requiresApproval: false, blocked: true, reason: `company policy doesn't allow alcohol at events on a weekday (${weekday})`, codes: ["OPEN_BAR_WEEKDAY"] };
  }

  // Each breach: its code, why, and whether it needs the senior (CFO, tier 2) level.
  const breaches: { code: PolicyViolationCode; reason: string; senior?: boolean }[] = [];

  if (spend && spend.monthly_limit > 0 && spend.month_to_date + input.total_amount > spend.monthly_limit) {
    breaches.push({
      code: "OVER_MONTHLY_LIMIT",
      senior: true,
      reason: `it takes this month's committed spend to ${inr(spend.month_to_date + input.total_amount)}, over the company's ${inr(spend.monthly_limit)} monthly limit`,
    });
  }
  if (department?.max_budget_per_head != null && input.per_head_amount > Number(department.max_budget_per_head)) {
    breaches.push({
      code: "DEPARTMENT_PER_HEAD_CAP",
      reason: `${inr(input.per_head_amount)} per head exceeds ${department.name}'s ${inr(Number(department.max_budget_per_head))} per-head budget`,
    });
  }
  if (department?.senior_approval_above != null && input.total_amount > Number(department.senior_approval_above)) {
    breaches.push({
      code: "DEPARTMENT_SENIOR_THRESHOLD",
      senior: true,
      reason: `it is above ${department.name}'s ${inr(Number(department.senior_approval_above))} threshold for senior sign-off`,
    });
  }

  if (rules) {
    if (input.alcohol_included && rules.alcohol_policy === "approval") {
      breaches.push({ code: "ALCOHOL_NEEDS_APPROVAL", reason: "it includes alcohol, which needs sign-off under company policy" });
    }
    if (weekday && rules.weekday_open_bar_policy === "approval") {
      breaches.push({ code: "OPEN_BAR_WEEKDAY", reason: `it includes alcohol on a weekday (${weekday}), which needs sign-off under company policy` });
    }
    const restricted = restrictedIn(rules, input.entertainment);
    if (restricted.length) {
      breaches.push({ code: "RESTRICTED_ENTERTAINMENT", reason: `it includes ${restricted.map(entertainmentLabel).join(" and ")}, which needs sign-off under company policy` });
    }
    if (input.event_type && rules.restricted_event_types?.includes(input.event_type)) {
      breaches.push({ code: "RESTRICTED_EVENT_TYPE", reason: `${EVENT_TYPES[input.event_type].toLowerCase()} events need sign-off under company policy` });
    }
    if (input.event_start_time && rules.event_hours_start && rules.event_hours_end && !withinEventHours(input.event_start_time, rules.event_hours_start, rules.event_hours_end)) {
      breaches.push({
        code: "OUTSIDE_EVENT_HOURS",
        reason: `it starts at ${hhmm(input.event_start_time)}, outside the ${hhmm(rules.event_hours_start)}–${hhmm(rules.event_hours_end)} event hours`,
      });
    }
    if (input.distance_from_office_km != null && rules.max_office_distance_km != null && input.distance_from_office_km > Number(rules.max_office_distance_km)) {
      breaches.push({
        code: "BEYOND_OFFICE_DISTANCE",
        reason: `the venue is ${input.distance_from_office_km.toFixed(1)} km from the office, beyond the ${Number(rules.max_office_distance_km)} km limit`,
      });
    }

    if (rules.max_budget_per_head !== null && input.per_head_amount > Number(rules.max_budget_per_head)) {
      breaches.push({
        code: "EXCEEDS_PER_HEAD_CAP",
        reason: `${inr(input.per_head_amount)} per head exceeds the ${inr(Number(rules.max_budget_per_head))} per-head budget`,
      });
    }
    const tier = perHeadTier(rules, input.per_head_amount);
    if (tier.status === "requires_cfo") breaches.push({ code: "PER_HEAD_CFO_TIER", senior: true, reason: tier.reason });
    if (tier.status === "requires_manager") breaches.push({ code: "PER_HEAD_MANAGER_TIER", reason: tier.reason });

    if (rules.requires_approval_above !== null && input.total_amount > Number(rules.requires_approval_above)) {
      breaches.push({
        code: "ABOVE_APPROVAL_THRESHOLD",
        reason: `${inr(input.total_amount)} total for ${input.headcount} ${input.unit ?? "guests"} is above the ${inr(Number(rules.requires_approval_above))} approval threshold`,
      });
    }
    if (rules.high_value_threshold != null && input.total_amount > Number(rules.high_value_threshold)) {
      breaches.push({
        code: "ABOVE_HIGH_VALUE_THRESHOLD",
        senior: true,
        reason: `it is above the ${inr(Number(rules.high_value_threshold))} high-value threshold, so it also needs senior sign-off`,
      });
    }
  }

  return breaches.length === 0
    ? { requiresApproval: false }
    : {
        requiresApproval: true,
        reason: breaches.map((b) => b.reason).join("; "),
        tiers: breaches.some((b) => b.senior) ? 2 : 1,
        codes: breaches.map((b) => b.code),
      };
}

/**
 * Where a per-head price falls in the company's approval tiers (auto / manager
 * / CFO). in_policy when no tiers are set.
 */
export function perHeadTier(
  rules: Pick<BookingPolicyRules, "auto_approval_limit_per_head" | "manager_approval_limit_per_head"> | null,
  perHead: number
): { status: "in_policy" } | { status: "requires_manager" | "requires_cfo"; reason: string } {
  const auto = rules?.auto_approval_limit_per_head;
  const manager = rules?.manager_approval_limit_per_head;
  if (manager != null && perHead > Number(manager)) {
    return { status: "requires_cfo", reason: `${inr(perHead)} per head is above the ${inr(Number(manager))} manager limit, so it needs CFO sign-off` };
  }
  if (auto != null && perHead > Number(auto)) {
    const range = manager != null ? ` (manager sign-off up to ${inr(Number(manager))})` : "";
    return { status: "requires_manager", reason: `${inr(perHead)} per head is above the ${inr(Number(auto))} auto-approval limit${range}` };
  }
  return { status: "in_policy" };
}

export interface PolicyCheck {
  rule: "per_head" | "per_head_tier" | "approval_threshold" | "monthly_limit" | "alcohol" | "weekday_alcohol" | "entertainment" | "event_type" | "event_hours" | "office_distance";
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * The same rules as evaluateBookingPolicy, one line each, for itemised
 * display (e.g. /client/approvals). Unset limits are omitted, not "passed".
 */
export function describePolicyChecks(
  rules: BookingPolicyRules | null,
  input: Pick<
    BookingPolicyInput,
    "total_amount" | "per_head_amount" | "alcohol_included" | "entertainment" | "event_date" | "event_type" | "event_start_time" | "distance_from_office_km"
  >,
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
  if (rules.auto_approval_limit_per_head != null || rules.manager_approval_limit_per_head != null) {
    const tier = perHeadTier(rules, input.per_head_amount);
    checks.push({
      rule: "per_head_tier",
      label: "Approval tier",
      ok: tier.status === "in_policy",
      detail: tier.status === "in_policy" ? `${inr(input.per_head_amount)} per head: auto-approved` : tier.reason.replace(/^./, (c) => c.toUpperCase()),
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
  const weekday = weekdayOf(input.event_date);
  if (input.alcohol_included !== undefined && weekday && rules.weekday_open_bar_policy && rules.weekday_open_bar_policy !== "allowed") {
    checks.push({
      rule: "weekday_alcohol",
      label: "Weekday alcohol",
      ok: !input.alcohol_included,
      detail: input.alcohol_included
        ? `Alcohol on a ${weekday}; policy: ${rules.weekday_open_bar_policy === "prohibited" ? "not allowed" : "needs sign-off"}`
        : `No alcohol on a ${weekday}`,
    });
  }
  if (rules.restricted_event_types?.length) {
    const restricted = Boolean(input.event_type && rules.restricted_event_types.includes(input.event_type));
    checks.push({
      rule: "event_type",
      label: "Event type",
      ok: !restricted,
      detail: input.event_type ? `${EVENT_TYPES[input.event_type]}${restricted ? " (needs sign-off)" : ""}` : "Not given",
    });
  }
  if (rules.event_hours_start && rules.event_hours_end) {
    const window = `${hhmm(rules.event_hours_start)}–${hhmm(rules.event_hours_end)}`;
    const inside = !input.event_start_time || withinEventHours(input.event_start_time, rules.event_hours_start, rules.event_hours_end);
    checks.push({
      rule: "event_hours",
      label: "Event hours",
      ok: inside,
      detail: input.event_start_time ? `Starts ${hhmm(input.event_start_time)} vs ${window}` : `Start time not given (${window})`,
    });
  }
  if (rules.max_office_distance_km != null && input.distance_from_office_km != null) {
    const limit = Number(rules.max_office_distance_km);
    checks.push({
      rule: "office_distance",
      label: "Distance from office",
      ok: input.distance_from_office_km <= limit,
      detail: `${input.distance_from_office_km.toFixed(1)} km vs ${limit} km limit`,
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
