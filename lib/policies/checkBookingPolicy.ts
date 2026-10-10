import "server-only";

import { getCorporatePolicy, listBookings, listCompanies } from "@/lib/data";
import { evaluateBookingPolicy, monthToDateSpend, type BookingPolicyInput, type BookingPolicyResult, type SpendLimitInput } from "./evaluate-booking-policy";

export type { BookingPolicyInput, BookingPolicyResult } from "./evaluate-booking-policy";

/** The company's monthly limit and committed spend in the event's month (null without a date or a limit). */
export async function spendLimitFor(tenantId: string, eventDate: string | undefined, excludeBookingId?: string): Promise<SpendLimitInput | null> {
  if (!eventDate) return null;
  const company = (await listCompanies()).find((c) => c.id === tenantId);
  const limit = Number(company?.monthly_spend_limit_inr ?? 0);
  if (limit <= 0) return null;
  const bookings = await listBookings({ companyId: tenantId });
  return { monthly_limit: limit, month_to_date: monthToDateSpend(bookings, tenantId, eventDate, excludeBookingId) };
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
