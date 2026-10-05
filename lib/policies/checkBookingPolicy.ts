import "server-only";

import { getCorporatePolicy } from "@/lib/data";
import { evaluateBookingPolicy, type BookingPolicyInput, type BookingPolicyResult } from "./evaluate-booking-policy";

export type { BookingPolicyInput, BookingPolicyResult } from "./evaluate-booking-policy";

/**
 * Checks a prospective booking against its tenant's corporate_policies row.
 * Approval is required when the per-head amount exceeds max_budget_per_head or
 * the total exceeds requires_approval_above; a null limit (or no policy) never triggers.
 */
export async function checkBookingPolicy(input: BookingPolicyInput): Promise<BookingPolicyResult> {
  const policy = await getCorporatePolicy(input.tenant_id);
  return evaluateBookingPolicy(policy, input);
}
