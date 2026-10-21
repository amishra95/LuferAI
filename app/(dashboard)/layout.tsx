import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getAgent, syncAgentConfigs } from "@/lib/agents/store";
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
  // The in-page concierge drawer runs the same workspace chat as /chat, with the same checks.
  let chat = null;
  if (allowedHrefs.includes("/chat")) {
    await syncAgentConfigs();
    const agent = getAgent("workspace-agent");
    const chatModel = getLanguageModel({ backend: agent?.model, speed: "fast" });
    chat = { model: chatModel?.modelId ?? "none", offline: !chatModel, agentEnabled: agent?.enabled ?? true };
  }

  // `lufer` scopes the design system (warm light theme).
  return (
    <div className="lufer flex-1">
      <DashboardShell
        defaultCollapsed={sidebarCollapsed}
        workspaceName={workspaceName}
        system={model ? { mode: "live", model: model.modelId } : { mode: "demo" }}
        account={member ? { email: member.email, role: member.role } : null}
        allowedHrefs={allowedHrefs}
        chat={chat}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
