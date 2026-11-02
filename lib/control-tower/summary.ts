/**
 * Control Tower: one view of a company's event spend for finance and
 * procurement — every request, its policy outcome, sign-off and payment —
 * filtered by department, event type, city, status and period.
 *
 * Pure: the page loads bookings, approvals and payments and passes plain rows
 * here; tests/control-tower.test.mjs exercises it directly.
 */

import { EVENT_TYPES, type PolicyViolationCode } from "../policies/evaluate-booking-policy.ts";

export interface TowerBooking {
  id: string;
  company_id: string;
  company_name: string;
  venue_name: string;
  city: string;
  event_date: string;
  created_at: string;
  status: string;
  event_type: string | null;
  department_id: string | null;
  cost_center: string | null;
  requested_by: string | null;
  party_size: number;
  /** Pre-GST taxable value. */
  total_amount_inr: number;
  /** With GST. */
  invoice_total_inr: number;
  /** List per head before a rate card or negotiation; null when not recorded. */
  list_budget_per_head_inr: number | null;
  policy_status: string | null;
  policy_violation_reasons: readonly string[];
}

export interface TowerApproval {
  booking_id: string | null;
  status: string;
  created_at: string;
  /** When a later tier became the approver's turn; null for the first tier. */
  activated_at?: string | null;
  decided_at: string | null;
}

export interface TowerFilters {
  companyId?: string;
  departmentId?: string;
  eventType?: string;
  city?: string;
  status?: StatusGroup;
  /** Inclusive event-date range, YYYY-MM-DD. */
  from?: string;
  to?: string;
}

/** What a finance team asks about, rather than the booking lifecycle's own states. */
export const STATUS_GROUPS = {
  awaiting_signoff: { label: "Awaiting sign-off", statuses: ["PENDING_APPROVAL"] },
  with_venue: { label: "With the venue", statuses: ["PENDING"] },
  booked: { label: "Booked", statuses: ["CONFIRMED"] },
  completed: { label: "Completed", statuses: ["COMPLETED", "SETTLED"] },
  cancelled: { label: "Cancelled or declined", statuses: ["CANCELLED"] },
} as const;
export type StatusGroup = keyof typeof STATUS_GROUPS;
export const isStatusGroup = (v: unknown): v is StatusGroup => typeof v === "string" && Object.hasOwn(STATUS_GROUPS, v);

export const statusGroupOf = (status: string): StatusGroup | null =>
  (Object.entries(STATUS_GROUPS).find(([, g]) => (g.statuses as readonly string[]).includes(status))?.[0] as StatusGroup | undefined) ?? null;

/** Spend that's committed or spent: the request went ahead, or is on its way. */
const COMMITTED: ReadonlySet<string> = new Set(["PENDING_APPROVAL", "PENDING", "CONFIRMED", "COMPLETED", "SETTLED"]);

export const VIOLATION_LABEL: Record<PolicyViolationCode, string> = {
  EXCEEDS_PER_HEAD_CAP: "Over the per-head cap",
  PER_HEAD_MANAGER_TIER: "Per head needs a manager",
  PER_HEAD_CFO_TIER: "Per head needs the CFO",
  ABOVE_APPROVAL_THRESHOLD: "Above the approval threshold",
  ABOVE_HIGH_VALUE_THRESHOLD: "High-value event",
  OVER_MONTHLY_LIMIT: "Over the monthly limit",
  DEPARTMENT_PER_HEAD_CAP: "Over the department's per-head cap",
  DEPARTMENT_SENIOR_THRESHOLD: "Above the department's senior sign-off",
  ALCOHOL_NEEDS_APPROVAL: "Alcohol needs sign-off",
  ALCOHOL_PROHIBITED: "Alcohol not allowed",
  RESTRICTED_ENTERTAINMENT: "Restricted entertainment",
  OPEN_BAR_WEEKDAY: "Weekday open bar",
  RESTRICTED_EVENT_TYPE: "Restricted event type",
  OUTSIDE_EVENT_HOURS: "Outside allowed hours",
  BEYOND_OFFICE_DISTANCE: "Too far from the office",
};
export const violationLabel = (code: string) => VIOLATION_LABEL[code as PolicyViolationCode] ?? code.toLowerCase().replaceAll("_", " ");
export const eventTypeLabel = (type: string | null) => (type && Object.hasOwn(EVENT_TYPES, type) ? EVENT_TYPES[type as keyof typeof EVENT_TYPES] : "Not recorded");

export function filterBookings<T extends TowerBooking>(bookings: readonly T[], f: TowerFilters): T[] {
  const groupStatuses = f.status ? (STATUS_GROUPS[f.status].statuses as readonly string[]) : null;
  return bookings.filter(
    (b) =>
      (!f.companyId || b.company_id === f.companyId) &&
      (!f.departmentId || (f.departmentId === "none" ? b.department_id === null : b.department_id === f.departmentId)) &&
      (!f.eventType || (f.eventType === "none" ? b.event_type === null : b.event_type === f.eventType)) &&
      (!f.city || b.city === f.city) &&
      (!groupStatuses || groupStatuses.includes(b.status)) &&
      (!f.from || b.event_date >= f.from) &&
      (!f.to || b.event_date <= f.to)
  );
}

export interface Breakdown {
  key: string;
  requests: number;
  committedInr: number;
  /** In-policy share of the requests with a recorded policy outcome; null when none have one. */
  complianceRate: number | null;
}

export interface TowerSummary {
  requests: number;
  /** Invoice totals (with GST) of requests that went ahead or are on their way. */
  committedInr: number;
  /** Below list price: rate cards and negotiation, on committed requests with a list price. */
  savingsInr: number;
  /** In-policy share of requests with a recorded policy outcome (0–1); null when none have one. */
  complianceRate: number | null;
  /** Requests with a policy outcome, the denominator of complianceRate. */
  policyAssessed: number;
  policyCounts: Record<"in_policy" | "requires_manager" | "requires_cfo" | "out_of_policy", number>;
  /** Most frequent rule breaches, most first. */
  topViolations: { code: string; label: string; count: number }[];
  /** Median hours from a sign-off reaching its approver to their decision; null without any. */
  medianApprovalHours: number | null;
  awaitingSignoff: number;
  byDepartment: Breakdown[];
  byEventType: Breakdown[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
}

function rateOf(list: readonly TowerBooking[]): { rate: number | null; assessed: number } {
  const assessed = list.filter((b) => b.policy_status !== null);
  return { rate: assessed.length ? assessed.filter((b) => b.policy_status === "in_policy").length / assessed.length : null, assessed: assessed.length };
}

function breakdown(list: readonly TowerBooking[], keyOf: (b: TowerBooking) => string): Breakdown[] {
  const groups = new Map<string, TowerBooking[]>();
  for (const b of list) groups.set(keyOf(b), [...(groups.get(keyOf(b)) ?? []), b]);
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      requests: items.length,
      committedInr: round2(items.filter((b) => COMMITTED.has(b.status)).reduce((s, b) => s + b.invoice_total_inr, 0)),
      complianceRate: rateOf(items).rate,
    }))
    .sort((a, b) => b.committedInr - a.committedInr || b.requests - a.requests || a.key.localeCompare(b.key));
}

export function summarise(bookings: readonly TowerBooking[], approvals: readonly TowerApproval[]): TowerSummary {
  const committed = bookings.filter((b) => COMMITTED.has(b.status));
  const { rate, assessed } = rateOf(bookings);
  const policyCounts = { in_policy: 0, requires_manager: 0, requires_cfo: 0, out_of_policy: 0 };
  const violations = new Map<string, number>();
  for (const b of bookings) {
    if (b.policy_status && b.policy_status in policyCounts) policyCounts[b.policy_status as keyof typeof policyCounts] += 1;
    for (const code of new Set(b.policy_violation_reasons)) violations.set(code, (violations.get(code) ?? 0) + 1);
  }
  const ids = new Set(bookings.map((b) => b.id));
  const decidedHours = approvals
    .filter((a) => a.booking_id && ids.has(a.booking_id) && a.decided_at && (a.status === "APPROVED" || a.status === "REJECTED"))
    .map((a) => (Date.parse(a.decided_at!) - Date.parse(a.activated_at ?? a.created_at)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  const med = median(decidedHours);

  return {
    requests: bookings.length,
    committedInr: round2(committed.reduce((s, b) => s + b.invoice_total_inr, 0)),
    savingsInr: round2(
      committed.reduce((s, b) => s + (b.list_budget_per_head_inr != null ? Math.max(0, b.party_size * b.list_budget_per_head_inr - b.total_amount_inr) : 0), 0)
    ),
    complianceRate: rate,
    policyAssessed: assessed,
    policyCounts,
    topViolations: [...violations.entries()]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, 5)
      .map(([code, count]) => ({ code, label: violationLabel(code), count })),
    medianApprovalHours: med === null ? null : Math.round(med * 10) / 10,
    awaitingSignoff: bookings.filter((b) => b.status === "PENDING_APPROVAL").length,
    byDepartment: breakdown(bookings, (b) => b.department_id ?? "none"),
    byEventType: breakdown(bookings, (b) => b.event_type ?? "none"),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote anything with a delimiter, and defuse spreadsheet formulas (=, +, -, @ at the start).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The filtered requests as CSV for finance (one row per booking). */
export function towerCsv(
  rows: readonly (TowerBooking & { department_name: string | null; requester_name: string | null; payment_status: string | null })[]
): string {
  const header = [
    "Booking ID", "Company", "Event date", "Requested", "Requested by", "Department", "Cost centre", "Event type", "Venue", "City",
    "Guests", "Taxable (INR)", "Invoice total (INR)", "Status", "Policy", "Policy breaches", "Payment",
  ];
  const lines = rows.map((r) =>
    [
      r.id, r.company_name, r.event_date, r.created_at.slice(0, 10), r.requester_name, r.department_name, r.cost_center, eventTypeLabel(r.event_type),
      r.venue_name, r.city, r.party_size, r.total_amount_inr.toFixed(2), r.invoice_total_inr.toFixed(2), r.status, r.policy_status ?? "",
      r.policy_violation_reasons.map(violationLabel).join("; "), r.payment_status ?? "",
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
