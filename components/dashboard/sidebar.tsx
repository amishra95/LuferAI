"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

import { NAV_SECTIONS, isActive } from "@/components/dashboard/nav-config";
import { cn } from "@/lib/utils";

const ALL_HREFS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

/** Monogram: the brand mark, derived from the workspace name. */
export function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-fg text-canvas grid size-6 shrink-0 place-items-center rounded-[5px] font-mono text-[11px] font-semibold",
        className
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function Sidebar({
  workspaceName,
  allowedHrefs,
  collapsed,
  onToggle,
  onNavigate,
  onClose,
  className,
}: {
  workspaceName: string;
  allowedHrefs: string[];
  collapsed: boolean;
  /** Omit to hide the collapse control (e.g. inside the mobile drawer). */
  onToggle?: () => void;
  onNavigate?: () => void;
  /** Shows a close button (mobile drawer). */
  onClose?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const allowed = new Set(allowedHrefs);
  const sections = NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => allowed.has(i.href)) })).filter((s) => s.items.length > 0);

  return (
    <aside
      className={cn(
        "border-line flex h-full shrink-0 flex-col border-r transition-[width] duration-200 ease-out",
        collapsed ? "w-[3.75rem]" : "w-60",
        className
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" onClick={onNavigate} className="flex min-w-0 items-center gap-2.5 rounded-md">
          <Monogram name={workspaceName} />
          {!collapsed && <span className="text-fg truncate text-[13.5px] font-semibold tracking-tight">{workspaceName}</span>}
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close navigation" className="btn btn-ghost btn-icon ml-auto size-8">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pt-2 pb-4" aria-label="Dashboard">
        {sections.map((section, i) => (
          <div key={section.title ?? i} className={cn(i > 0 && "mt-6")}>
            {section.title &&
              (collapsed ? (
                <div className="border-line mx-3 mb-3 border-t" aria-hidden />
              ) : (
                <p className="label-mono mb-1.5 px-2.5">{section.title}</p>
              ))}
            <ul className="space-y-px">
              {section.items.map(({ href, label, icon: Icon }) => {
                // The most specific item wins (/client/approvals, not /client too).
                const active = isActive(pathname, href) && !ALL_HREFS.some((h) => h.length > href.length && isActive(pathname, h));
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      title={collapsed ? label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] tracking-[-0.005em] transition-[color,background-color,box-shadow,transform] duration-150",
                        collapsed && "justify-center px-0",
                        active ? "bg-surface-raised text-fg" : "text-fg-subtle hover:bg-surface-raised hover:text-fg"
                      )}
                    >
                      {/* Copper rail marks the current page. */}
                      {active && <span aria-hidden className="bg-fg absolute top-2 bottom-2 -left-2.5 w-[2px] rounded-r-full" />}
                      <Icon
                        className={cn("size-[15px] shrink-0 transition-colors", active ? "text-fg" : "text-fg-faint group-hover:text-fg-muted")}
                        strokeWidth={1.75}
                        aria-hidden
                      />
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
        <div className="border-line shrink-0 border-t p-2.5">
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
            className={cn(
              "text-fg-subtle hover:bg-surface-raised hover:text-fg flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] transition-[color,background-color,transform] duration-150",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[15px]" strokeWidth={1.75} aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-[15px]" strokeWidth={1.75} aria-hidden />
                <span>Collapse</span>
                <kbd className="text-fg-subtle ml-auto font-mono text-[10.5px]">⌘B</kbd>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
