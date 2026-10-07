"use client";

import { useEffect, useState } from "react";

import { Drawer } from "@/components/dashboard/drawer";
import { Header } from "@/components/dashboard/header";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-config";
import { Sidebar } from "@/components/dashboard/sidebar";
import { ToastProvider } from "@/components/dashboard/toast";
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
  account: { email: string | null } | null;
  /** Nav items this user may open; the sidebar hides the rest. */
  allowedHrefs: string[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  // ⌘B / Ctrl+B toggles the sidebar, like most editors.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setCollapsed((c) => {
          document.cookie = `${SIDEBAR_COOKIE}=${c ? "0" : "1"}; path=/; max-age=31536000; samesite=lax`;
          return !c;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar workspaceName={workspaceName} allowedHrefs={allowedHrefs} collapsed={collapsed} onToggle={toggle} className="hidden md:flex" />

        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} side="left" label="Navigation" className="md:hidden">
          <Sidebar workspaceName={workspaceName} allowedHrefs={allowedHrefs} collapsed={false} onNavigate={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} />
        </Drawer>

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* A single, very faint copper bloom: the only ornament in the chrome. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(48rem_16rem_at_30%_-6rem,rgb(245_158_11/0.07),transparent)]"
          />
          <Header workspaceName={workspaceName} system={system} account={account} onOpenMobileNav={() => setMobileOpen(true)} />
          {/* Pages own their padding and width: most scroll, Chat fills the pane. */}
          <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
