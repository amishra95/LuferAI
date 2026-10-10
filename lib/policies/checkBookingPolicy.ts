import "server-only";

import { getCorporatePolicy, listBookings, listCatalogOrders, listCompanies } from "@/lib/data";
import { evaluateBookingPolicy, monthToDateSpend, type BookingPolicyInput, type BookingPolicyResult, type SpendLimitInput } from "./evaluate-booking-policy";

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
 * Checks a prospective booking against its tenant's corporate_policies row and
 * the company-wide monthly spend limit (lib/policies/evaluate-booking-policy.ts):
 * per-head cap, approval and high-value thresholds, alcohol and entertainment
 * rules. A null limit (or no policy) never triggers.
 */
export async function checkBookingPolicy(input: BookingPolicyInput): Promise<BookingPolicyResult> {
  const [policy, spend] = await Promise.all([getCorporatePolicy(input.tenant_id), spendLimitFor(input.tenant_id, input.event_date)]);
  return evaluateBookingPolicy(policy, input, spend);
}
