import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getLanguageModel } from "@/lib/ai/model";
import { getPreferences } from "@/lib/settings/preferences";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Lufer.ai" },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, workspaceName } = await getPreferences();
  const model = getLanguageModel();

  // `lufer` scopes the design system (warm light theme).
  return (
    <div className="lufer flex-1">
      <DashboardShell
        defaultCollapsed={sidebarCollapsed}
        workspaceName={workspaceName}
        system={model ? { mode: "live", model: model.modelId } : { mode: "demo" }}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
