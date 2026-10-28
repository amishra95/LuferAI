import "server-only";

import { listApprovals, listBookings, listCompanies, listDepartments, listPortalUsers } from "@/lib/data";
import { latestPayments } from "@/lib/payments/service";
import { isEventType } from "@/lib/policies/evaluate-booking-policy";
import { filterBookings, isStatusGroup, summarise, type TowerBooking, type TowerFilters } from "./summary";

export type TowerRow = TowerBooking & { department_name: string | null; requester_name: string | null; payment_status: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Latest payment per booking, in chunks so an all-companies view stays within URL limits. Never throws. */
async function paymentsFor(ids: string[]): Promise<Map<string, { status: string }>> {
  const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
  try {
    return new Map((await Promise.all(chunks.map(latestPayments))).flatMap((m) => [...m]));
  } catch (err) {
    console.error("control tower: payments unavailable", err);
    return new Map();
  }
}

/**
 * Filters from the query string, dropping anything malformed. companyId is
 * only honoured for admins; clients are pinned to their own company.
 */
export function parseTowerFilters(params: Record<string, string | string[] | undefined>, pinnedCompanyId: string | null): TowerFilters {
  const eventType = one(params.type);
  const status = one(params.status);
  const from = one(params.from);
  const to = one(params.to);
  return {
    companyId: pinnedCompanyId ?? one(params.company),
    departmentId: one(params.dept),
    eventType: eventType === "none" || isEventType(eventType) ? eventType : undefined,
    city: one(params.city),
    status: isStatusGroup(status) ? status : undefined,
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  };
}

/**
 * The Control Tower's rows and summary for one company (clients) or every
 * company or one (admins). Options for the filter menus come from the
 * unfiltered rows, so a filter never hides its own alternatives.
 */
export async function loadControlTower(filters: TowerFilters) {
  const companyIds = filters.companyId ? [filters.companyId] : undefined;
  const [bookings, companies, departments, users, approvals] = await Promise.all([
    listBookings(filters.companyId ? { companyId: filters.companyId } : {}),
    listCompanies(),
    listDepartments(companyIds ? { companyIds } : {}),
    listPortalUsers(filters.companyId ? { companyId: filters.companyId } : {}),
    listApprovals(filters.companyId ? { tenantId: filters.companyId } : {}),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const all: TowerBooking[] = bookings.map((b) => ({
    id: b.id,
    company_id: b.company_id,
    company_name: b.company.legal_name,
    venue_name: b.venue.name,
    city: b.venue.city,
    event_date: b.event_date,
    created_at: b.created_at,
    status: b.status,
    event_type: b.event_type,
    department_id: b.department_id,
    cost_center: b.cost_center,
    requested_by: b.requested_by,
    party_size: b.party_size,
    total_amount_inr: Number(b.total_amount_inr),
    invoice_total_inr: b.invoice.invoice_total,
    list_budget_per_head_inr: b.list_budget_per_head_inr != null ? Number(b.list_budget_per_head_inr) : null,
    policy_status: b.policy_status,
    policy_violation_reasons: b.policy_violation_reasons ?? [],
  }));
  const matched = filterBookings(all, filters).sort((a, b) => b.event_date.localeCompare(a.event_date));
  const payments = await paymentsFor(matched.map((b) => b.id));

  const rows: TowerRow[] = matched.map((b) => ({
    ...b,
    department_name: b.department_id ? (deptName.get(b.department_id) ?? null) : null,
    requester_name: b.requested_by ? (userName.get(b.requested_by) ?? null) : null,
    payment_status: payments.get(b.id)?.status ?? null,
  }));

  return {
    rows,
    summary: summarise(matched, approvals),
    deptName,
    options: {
      companies: companies.map((c) => ({ id: c.id, name: c.legal_name })),
      departments: departments.map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)),
      cities: [...new Set(all.map((b) => b.city))].sort(),
      hasUnassignedDept: all.some((b) => b.department_id === null),
    },
  };
}
