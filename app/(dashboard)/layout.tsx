import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getLanguageModel } from "@/lib/ai/model";
import { canAccess, canAccessWorkspace, PORTALS, WORKSPACE_ROUTES } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { getPreferences } from "@/lib/settings/preferences";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Lufer.ai" },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, workspaceName } = await getPreferences();
  const model = getLanguageModel();
  const member = await getCurrentMember();
  const allowedHrefs = member
    ? [
        ...PORTALS.filter((p) => canAccess(member.role, p)),
        ...WORKSPACE_ROUTES.filter((r) => canAccessWorkspace(member.role, member.corporateRole, r)),
        ...(member.canApprove || member.role === "ADMIN" ? ["/client/approvals"] : []),
        ...(member.role === "ADMIN" ? ["/admin/analytics"] : []),
      ]
    : [];

  // `lufer` scopes the design system (warm light theme).
  return (
    <div className="lufer flex-1">
      <DashboardShell
        defaultCollapsed={sidebarCollapsed}
        workspaceName={workspaceName}
        system={model ? { mode: "live", model: model.modelId } : { mode: "demo" }}
        account={member ? { email: member.email, role: member.role } : null}
        allowedHrefs={allowedHrefs}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
