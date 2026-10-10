import "server-only";

import type { TaxInvoicePayload } from "@/lib/gst-engine";

import type { Member } from "@/lib/auth/session";
import {
  dataSource,
  getCorporatePolicy,
  listApprovals,
  listBookings,
  listCatalogOrders,
  listDepartments,
  type CatalogOrderDetail,
  type ApprovalDetail as ApprovalRow,
  type BookingDetail,
} from "@/lib/data";
import { financialYear } from "@/lib/fiscal-year";
import { sumInr } from "@/lib/gst-engine";
import { spendLimitFor } from "@/lib/policies/checkBookingPolicy";
import { describePolicyChecks, type PolicyCheck } from "@/lib/policies/evaluate-booking-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Department } from "@/lib/supabase/database.types";

/**
 * UI-facing helpers over the approval / hold model from migrations 0007–0010:
 * booking_approvals decide PENDING_APPROVAL bookings, and inventory_holds lock a
 * venue date while a booking is pending. Writes stay in lib/data (main's
 * createBookingRequest / decideApproval) and the DB triggers.
 */

// ----------------------------------------------------------------------------
// Holds
// ----------------------------------------------------------------------------

export interface ActiveHold {
  holdStart: string;
  expiresAt: string;
}

/** Live (ACTIVE, unexpired) holds by booking id, for countdown meters. */
export async function activeHolds(bookingIds: string[]): Promise<Map<string, ActiveHold>> {
  const out = new Map<string, ActiveHold>();
  if (dataSource() !== "supabase" || bookingIds.length === 0) return out;
  const { data, error } = await createAdminClient()
    .from("inventory_holds")
    .select("booking_id, hold_start, hold_expires_at")
    .in("booking_id", bookingIds)
    .eq("status", "ACTIVE")
    .gt("hold_expires_at", new Date().toISOString());
  if (error) throw error;
  for (const h of data) out.set(h.booking_id, { holdStart: h.hold_start, expiresAt: h.hold_expires_at });
  return out;
}

/**
 * Cron housekeeping: holds stop locking a date the moment they expire (the checks
 * compare hold_expires_at), but stay ACTIVE in the table. This marks them RELEASED
 * so reports and the property hold list stay accurate.
 */
export async function releaseExpiredHolds(): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("inventory_holds")
    .update({ status: "RELEASED" })
    .eq("status", "ACTIVE")
    .lt("hold_expires_at", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return data.length;
}

// ----------------------------------------------------------------------------
// Approvals (/client/approvals)
// ----------------------------------------------------------------------------

/** Pending approvals this member should decide: their own queue, or all for an admin. */
export async function approvalQueue(member: Member, companyId: string): Promise<ApprovalRow[]> {
  if (member.role === "ADMIN") return listApprovals({ tenantId: companyId, status: "PENDING" });
  if (!member.canApprove || member.companyId !== companyId) return [];
  return listApprovals({ tenantId: companyId, approverId: member.userId, status: "PENDING" });
}

export interface OrderItemisation {
  approval: ApprovalRow;
  order: CatalogOrderDetail;
  invoice: TaxInvoicePayload;
  checks: PolicyCheck[];
}

/** One queued order approval: its invoice (at the item's own HSN/SAC rate) and the policy checks. */
export async function orderItemisation(approval: ApprovalRow, companyId: string): Promise<OrderItemisation | null> {
  if (!approval.catalog_order_id) return null;
  const [[order], policy] = await Promise.all([listCatalogOrders({ tenantId: companyId, ids: [approval.catalog_order_id] }), getCorporatePolicy(companyId)]);
  if (!order) return null;
  // The order itself is already committed, so it's left out of "spend so far".
  const spend = await spendLimitFor(companyId, order.event_date ?? order.needed_by ?? order.created_at.slice(0, 10), order.id);
  const checks = describePolicyChecks(policy, { total_amount: order.total_amount_inr, per_head_amount: order.unit_price_inr }, spend);
  return { approval, order, invoice: order.invoice as unknown as TaxInvoicePayload, checks };
}

export interface ApprovalItemisation {
  approval: ApprovalRow;
  booking: BookingDetail;
  checks: PolicyCheck[];
  department: (Pick<Department, "id" | "name" | "annual_budget_inr"> & { fyCommittedInr: number }) | null;
}

/** One queued approval with its booking's GST breakdown and the policy checks behind it. */
export async function approvalItemisation(
  approval: ApprovalRow,
  companyId: string
): Promise<ApprovalItemisation | null> {
  const [bookings, policy] = await Promise.all([listBookings({ companyId }), getCorporatePolicy(companyId)]);
  const booking = bookings.find((b) => b.id === approval.booking_id);
  if (!booking) return null;

  const checks = describePolicyChecks(
    policy,
    {
      total_amount: booking.total_amount_inr,
      per_head_amount: booking.budget_per_head_inr,
      alcohol_included: booking.alcohol_included,
      entertainment: booking.entertainment,
    },
    await spendLimitFor(companyId, booking.event_date, booking.id)
  );


  // Department budgets are informational here: routing is by corporate_policies.
  let department: ApprovalItemisation["department"] = null;
  if (booking.department_id) {
    const dept = (await listDepartments({ companyIds: [booking.company_id] })).find((d) => d.id === booking.department_id);
    if (dept) {
      const fy = financialYear(booking.event_date);
      const committed = bookings.filter(
        (b) =>
          b.department_id === dept.id &&
          b.id !== booking.id &&
          b.status !== "CANCELLED" &&
          b.event_date >= fy.start &&
          b.event_date <= fy.end
      );
      department = { id: dept.id, name: dept.name, annual_budget_inr: dept.annual_budget_inr, fyCommittedInr: sumInr(committed.map((b) => b.total_amount_inr)) };
    }
  }

  return { approval, booking, checks, department };
}
