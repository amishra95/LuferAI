"use client";

import { useCallback, useEffect, useState } from "react";

import { CommandPalette } from "@/components/dashboard/command-palette";
import { Drawer } from "@/components/dashboard/drawer";
import { Header } from "@/components/dashboard/header";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-config";
import { Sidebar } from "@/components/dashboard/sidebar";
import { ToastProvider } from "@/components/dashboard/toast";
import { ChatDrawerProvider, type ChatDrawerConfig } from "@/components/ui/chat-drawer";
import { FloatingAiConcierge } from "@/components/ui/floating-ai-concierge";
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
  chat,
  children,
}: {
  defaultCollapsed: boolean;
  workspaceName: string;
  system: SystemMode;
  account: { email: string | null; role: PortalRole } | null;
  /** Nav items this user may open; the sidebar hides the rest. */
  allowedHrefs: string[];
  /** The in-page concierge drawer; null for users who can't use the workspace chat. */
  chat: ChatDrawerConfig | null;
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

  // Live telemetry carries operator data (admins) and venue syncs (/venues users). Venue hosts
  // get their venue's escalations and bookings, client users their company's bookings
  // (lib/telemetry/events.ts visibleTo).
  const live = account?.role === "ADMIN" || account?.role === "PROPERTY" || account?.role === "CLIENT" || allowedHrefs.includes("/venues");

  const content = (
    <>
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
          {/* Concierge shortcut: renders only inside the drawer provider. */}
          <FloatingAiConcierge />
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
    </>
  );

  return (
    <WorkspaceProvider live={live}>
      <ToastProvider>
        {/* The concierge drawer, for everyone who can use the workspace chat. */}
        {chat ? <ChatDrawerProvider config={chat}>{content}</ChatDrawerProvider> : content}
      </ToastProvider>
    </WorkspaceProvider>
  );
}
