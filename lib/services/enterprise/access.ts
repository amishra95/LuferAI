import type { Member } from "@/lib/auth/session";

/**
 * Who may see and change a company's governance (approval rules, hierarchy,
 * team budgets). Every client role can see its own company's; Approvers and
 * platform admins can change them. Organizers and Finance viewers read only.
 *
 * Pure: tests import it directly (tests/enterprise-governance.test.mjs).
 */

type Who = Pick<Member, "role" | "companyId" | "corporateRole">;

export const canViewGovernance = (m: Who) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId);

export const canManageGovernance = (m: Who) => m.role === "ADMIN" || (m.role === "CLIENT" && !!m.companyId && m.corporateRole === "APPROVER");

/** The company acted on: a client's own, whatever they ask for; the one an admin picks (null until they do). */
export function governedCompany(m: Who, requested: string | null | undefined): string | null {
  if (m.role === "CLIENT") return m.companyId;
  if (m.role === "ADMIN") return requested || null;
  return null;
}
