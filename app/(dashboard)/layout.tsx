import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getPreferences } from "@/lib/settings/preferences";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Lufer.ai" },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, workspaceName } = await getPreferences();

  // `dark` pins the shell to the dark token set regardless of OS theme.
  return (
    <div className="dark bg-background text-foreground flex-1">
      <DashboardShell defaultCollapsed={sidebarCollapsed} workspaceName={workspaceName}>{children}</DashboardShell>
    </div>
  );
}
