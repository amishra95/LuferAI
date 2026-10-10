"use client";

import { useCallback, useEffect, useState } from "react";

import { CommandPalette } from "@/components/dashboard/command-palette";
import { Drawer } from "@/components/dashboard/drawer";
import { Header } from "@/components/dashboard/header";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-config";
import { Sidebar } from "@/components/dashboard/sidebar";
import { ToastProvider } from "@/components/dashboard/toast";
import { InspectorSidebar } from "@/components/workspace/inspector-sidebar";
import { LiveRefresh } from "@/components/workspace/live-refresh";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import type { PortalRole } from "@/lib/supabase/database.types";
import type { SystemMode } from "@/types/navigation";

export function DashboardShell({
  defaultCollapsed,
  workspaceName,
  system,
  account,
  allowedHrefs,
  children,
}: {
  defaultCollapsed: boolean;
  workspaceName: string;
  system: SystemMode;
  account: { email: string | null; role: PortalRole } | null;
  /** Nav items this user may open; the sidebar hides the rest. */
  allowedHrefs: string[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      document.cookie = `${SIDEBAR_COOKIE}=${c ? "0" : "1"}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  }, []);

  // ⌘B / Ctrl+B toggles the sidebar, like most editors.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Live telemetry carries operator data (admins) and venue syncs (/venues users).
  const live = account?.role === "ADMIN" || allowedHrefs.includes("/venues");

  return (
    <WorkspaceProvider live={live}>
      <ToastProvider>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar workspaceName={workspaceName} allowedHrefs={allowedHrefs} collapsed={collapsed} onToggle={toggle} className="hidden md:flex" />

          <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} side="left" label="Navigation" className="md:hidden">
            <Sidebar workspaceName={workspaceName} allowedHrefs={allowedHrefs} collapsed={false} onNavigate={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} />
          </Drawer>

          <div className="relative flex min-w-0 flex-1 flex-col">
            <Header
              workspaceName={workspaceName}
              system={system}
              account={account}
              onOpenMobileNav={() => setMobileOpen(true)}
              onOpenPalette={() => setPaletteOpen(true)}
            />
            {/* Pages own their padding and width: most scroll, Chat fills the pane. */}
            <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
          </div>

          {/* Entity inspector: docked beside the page on wide screens, an overlay below lg. */}
          <InspectorSidebar />
          <LiveRefresh />
        </div>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          allowedHrefs={allowedHrefs}
          role={account?.role ?? null}
          onToggleSidebar={toggle}
        />
      </ToastProvider>
    </WorkspaceProvider>
  );
}
