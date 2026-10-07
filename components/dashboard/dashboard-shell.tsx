"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Header } from "@/components/dashboard/header";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-config";
import { Sidebar } from "@/components/dashboard/sidebar";

export function DashboardShell({
  defaultCollapsed,
  workspaceName,
  children,
}: {
  defaultCollapsed: boolean;
  workspaceName: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar workspaceName={workspaceName} collapsed={collapsed} onToggle={toggle} className="hidden md:flex" />

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="relative h-full w-60">
            <Sidebar workspaceName={workspaceName} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="text-muted-foreground hover:text-foreground absolute top-3.5 right-3 grid size-7 place-items-center rounded-md"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header workspaceName={workspaceName} onOpenMobileNav={() => setMobileOpen(true)} />
        {/* Pages own their padding and width: Overview scrolls, Chat fills the pane. */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
