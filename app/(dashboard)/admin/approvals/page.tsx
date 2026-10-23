import type { Metadata } from "next";

import { AdminTabs } from "@/components/admin/admin-tabs";
import { ApplicationQueue, type QueueItem } from "@/components/admin/application-queue";
import { PortalShell } from "@/components/portal/portal-shell";
import { requirePortal } from "@/lib/auth/session";
import { listCompanies, listSignupApplications } from "@/lib/data";

export const metadata: Metadata = { title: "Account approvals" };

/**
 * Platform admins approve or reject self-service signups (/signup): enterprise
 * buyers and partners. Approving creates the organisation and portal access.
 */
export default async function AccountApprovalsPage() {
  const member = await requirePortal("/admin");
  // The admin portal admits only admins; this is the page's own check.
  if (member.role !== "ADMIN") return null;
  const [applications, companies] = await Promise.all([listSignupApplications(), listCompanies()]);
  const companyByGstin = new Map(companies.map((c) => [c.gstin, c.legal_name]));
  const toItem = (a: (typeof applications)[number]): QueueItem => ({
    ...a,
    joinsCompany: a.account_type === "enterprise" && a.gstin && a.status === "pending_approval" ? (companyByGstin.get(a.gstin) ?? null) : null,
  });
  const pending = applications.filter((a) => a.status === "pending_approval").map(toItem);
  const decided = applications
    .filter((a) => a.status !== "pending_approval")
    .sort((a, b) => (b.reviewed_at ?? "").localeCompare(a.reviewed_at ?? ""))
    .slice(0, 20)
    .map(toItem);

  return (
    <PortalShell portal="/admin" title="Account approvals" subtitle="Companies and partners who applied at /signup. Approving gives them their portal.">
      <AdminTabs current="/admin/approvals" />
      <ApplicationQueue pending={pending} decided={decided} />
    </PortalShell>
  );
}
