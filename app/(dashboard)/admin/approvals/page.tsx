import type { Metadata } from "next";

import { AdminTabs } from "@/components/admin/admin-tabs";
import { ApplicationQueue, UnlistedVenues, type QueueItem } from "@/components/admin/application-queue";
import { PortalShell } from "@/components/portal/portal-shell";
import { requirePortal } from "@/lib/auth/session";
import { listCompanies, listSignupApplications, listVenues } from "@/lib/data";

export const metadata: Metadata = { title: "Account approvals" };

/**
 * Self-service signups (/signup): most are active as soon as the email is
 * verified; the ones joining an existing company or venue wait here for an
 * admin. Venues that signed up themselves are unlisted until an admin
 * publishes them.
 */
export default async function AccountApprovalsPage() {
  const member = await requirePortal("/admin");
  // The admin portal admits only admins; this is the page's own check.
  if (member.role !== "ADMIN") return null;
  const [applications, companies, venues] = await Promise.all([listSignupApplications(), listCompanies(), listVenues({ includeUnlisted: true })]);
  const companyByGstin = new Map(companies.map((c) => [c.gstin, c.legal_name]));
  const venueByGstin = new Map(venues.map((v) => [v.gstin, v.name]));
  const toItem = (a: (typeof applications)[number]): QueueItem => ({
    ...a,
    joinsCompany: a.account_type === "enterprise" && a.gstin && a.status === "pending_approval" ? (companyByGstin.get(a.gstin) ?? null) : null,
    venueTaken: a.account_type === "venue" && a.gstin && a.status === "pending_approval" ? (venueByGstin.get(a.gstin) ?? null) : null,
  });
  const unlisted = venues.filter((v) => !v.is_active);
  const pending = applications.filter((a) => a.status === "pending_approval").map(toItem);
  const decided = applications
    .filter((a) => a.status !== "pending_approval")
    .sort((a, b) => (b.reviewed_at ?? "").localeCompare(a.reviewed_at ?? ""))
    .slice(0, 20)
    .map(toItem);

  return (
    <PortalShell portal="/admin" title="Account approvals" subtitle="Signups from /signup: venues to publish, and accounts that need a decision.">
      <AdminTabs current="/admin/approvals" />
      <UnlistedVenues venues={unlisted.map((v) => ({ id: v.id, name: v.name, area: `${v.neighborhood}, ${v.city}`, address: v.address, gstin: v.gstin, capacity: v.capacity_max }))} />
      <ApplicationQueue pending={pending} decided={decided} />
    </PortalShell>
  );
}
