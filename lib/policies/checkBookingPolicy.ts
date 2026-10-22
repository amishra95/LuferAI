import "server-only";

import { dataSource, getCorporatePolicy, listBookings, listCatalogOrders, listCompanies, listDepartments } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { distanceKm, officeOf, type LatLng } from "@/lib/venues/discovery";
import {
  describePolicyChecks,
  evaluateBookingPolicy,
  monthToDateSpend,
  policyMetadata,
  type BookingPolicyInput,
  type BookingPolicyResult,
  type DepartmentPolicyRules,
  type EventType,
  type PolicyCheck,
  type PolicyStatus,
  type PolicyViolationCode,
  type SpendLimitInput,
} from "./evaluate-booking-policy";

export type { BookingPolicyInput, BookingPolicyResult } from "./evaluate-booking-policy";

/**
 * The company's monthly limit and committed spend in the month (null without a
 * date or a limit). Venue bookings and catalogue orders both count; an order
 * counts in the month of its event, or of its needed-by date for goods.
 */
export async function spendLimitFor(tenantId: string, eventDate: string | undefined, excludeId?: string): Promise<SpendLimitInput | null> {
  if (!eventDate) return null;
  const company = (await listCompanies()).find((c) => c.id === tenantId);
  const limit = Number(company?.monthly_spend_limit_inr ?? 0);
  if (limit <= 0) return null;
  const [bookings, orders] = await Promise.all([listBookings({ companyId: tenantId }), listCatalogOrders({ tenantId })]);
  const spend = [
    ...bookings,
    ...orders.map((o) => ({ id: o.id, company_id: o.tenant_id, event_date: o.event_date ?? o.needed_by ?? o.created_at.slice(0, 10), status: o.status, total_amount_inr: o.total_amount_inr })),
  ];
  return { monthly_limit: limit, month_to_date: monthToDateSpend(spend, tenantId, eventDate, excludeId) };
}

/**
 * The charged department's own limits (department_policies, migration 0033), or
 * null. Supabase only; before the migration is applied there are none.
 */
export async function departmentPolicyFor(tenantId: string, departmentId: string | null | undefined): Promise<DepartmentPolicyRules | null> {
  if (!departmentId || dataSource() !== "supabase") return null;
  const [{ data, error }, departments] = await Promise.all([
    createAdminClient().from("department_policies").select("*").eq("tenant_id", tenantId).eq("department_id", departmentId).maybeSingle(),
    listDepartments({ companyIds: [tenantId] }),
  ]);
  if (error) {
    // 42P01: migration 0033 not applied yet.
    if (error.code !== "42P01") console.error("policy: department policy lookup failed", error.message);
    return null;
  }
  if (!data) return null;
  return {
    name: departments.find((d) => d.id === departmentId)?.name ?? "the department",
    max_budget_per_head: data.max_budget_per_head_inr === null ? null : Number(data.max_budget_per_head_inr),
    senior_approval_above: data.senior_approval_above_inr === null ? null : Number(data.senior_approval_above_inr),
  };
}

/**
 * Checks a prospective booking against its tenant's corporate_policies row and
 * the company-wide monthly spend limit (lib/policies/evaluate-booking-policy.ts):
 * per-head cap, approval and high-value thresholds, alcohol and entertainment
 * rules, plus the charged department's own caps. A null limit (or no policy) never triggers.
 */
export async function checkBookingPolicy(input: BookingPolicyInput): Promise<BookingPolicyResult> {
  const [policy, spend, department] = await Promise.all([
    getCorporatePolicy(input.tenant_id),
    spendLimitFor(input.tenant_id, input.event_date),
    departmentPolicyFor(input.tenant_id, input.department_id),
  ]);
  return evaluateBookingPolicy(policy, input, spend, department);
}

/** What's known about an event when its policy is evaluated. */
export interface EventPolicyDetails {
  headcount: number;
  /** Pre-GST total; defaults to headcount × spend per head (pass the priced total when a minimum spend applies). */
  totalAmount?: number;
  eventDate?: string;
  eventType?: EventType | null;
  /** "HH:MM". */
  startTime?: string | null;
  alcoholIncluded?: boolean;
  entertainment?: string[];
  departmentId?: string | null;
  /** The venue, for the distance-from-office rule. */
  venue?: { latitude: number | null; longitude: number | null } | null;
}

export interface EventPolicyEvaluation {
  result: BookingPolicyResult;
  status: PolicyStatus;
  codes: PolicyViolationCode[];
  /** One line per rule the company has set, for the booking and RFP banners. */
  checks: PolicyCheck[];
}

/** Straight-line km from the company's office to the venue; null if either is unknown. */
async function officeDistanceKm(companyId: string, venue: EventPolicyDetails["venue"]): Promise<number | null> {
  if (venue?.latitude == null || venue.longitude == null) return null;
  const company = (await listCompanies()).find((c) => c.id === companyId);
  const office = company ? officeOf(company) : null;
  return office ? distanceKm(office, venue as LatLng) : null;
}

/**
 * The company's full spend policy for an event: per-head approval tiers,
 * caps and thresholds, monthly limit, department limits, and the event's
 * context (type, start time, alcohol on a weekday, distance from the office).
 * The result drives approval routing (placeBookingRequest) and is stored on
 * bookings and RFPs (policyMetadata).
 */
export async function evaluateEventPolicy(companyId: string, spendPerHead: number, event: EventPolicyDetails): Promise<EventPolicyEvaluation> {
  const [policy, spend, department, distance] = await Promise.all([
    getCorporatePolicy(companyId),
    spendLimitFor(companyId, event.eventDate),
    departmentPolicyFor(companyId, event.departmentId),
    officeDistanceKm(companyId, event.venue),
  ]);
  const input = {
    total_amount: event.totalAmount ?? event.headcount * spendPerHead,
    headcount: event.headcount,
    per_head_amount: spendPerHead,
    event_date: event.eventDate,
    event_type: event.eventType ?? null,
    event_start_time: event.startTime ?? null,
    alcohol_included: event.alcoholIncluded ?? false,
    entertainment: event.entertainment ?? [],
    distance_from_office_km: distance,
  };
  const result = evaluateBookingPolicy(policy, input, spend, department);
  const { policy_status, policy_violation_reasons } = policyMetadata(result);
  return { result, status: policy_status, codes: policy_violation_reasons, checks: describePolicyChecks(policy, input, spend) };
}
