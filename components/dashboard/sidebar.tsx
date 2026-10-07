"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { NAV_SECTIONS, isActive } from "@/components/dashboard/nav-config";
import { cn } from "@/lib/utils";

export function Sidebar({
  workspaceName,
  collapsed,
  onToggle,
  onNavigate,
  className,
}: {
  workspaceName: string;
  collapsed: boolean;
  /** Omit to hide the collapse control (e.g. inside the mobile drawer). */
  onToggle?: () => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "bg-background flex h-full flex-col border-r transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-60",
        className
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b px-3", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="bg-foreground text-background grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold">
            {workspaceName.charAt(0).toUpperCase()}
          </span>
          {!collapsed && <span className="truncate text-sm">{workspaceName}</span>}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Dashboard">
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.title ?? i} className={cn(i > 0 && "mt-5")}>
            {section.title &&
              (collapsed ? (
                <div className="mx-2 mb-2 border-t" aria-hidden />
              ) : (
                <p className="text-muted-foreground mb-1 px-2 font-mono text-[11px] tracking-wider uppercase">
                  {section.title}
                </p>
              ))}
            <ul className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      title={collapsed ? label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "text-muted-foreground hover:bg-secondary hover:text-foreground flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors",
                        collapsed && "justify-center px-0",
                        active && "bg-secondary text-foreground font-medium"
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {onToggle && (
        <div className="shrink-0 border-t p-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "text-muted-foreground hover:bg-secondary hover:text-foreground flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm transition-colors",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-4" aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
