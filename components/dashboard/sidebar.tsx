"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

import { useNavBadges } from "@/components/dashboard/nav-badges";
import { SIDES, isItemActive, sideHome, sideSections } from "@/components/dashboard/nav-config";
import { cn } from "@/lib/utils";
import type { Side } from "@/types/navigation";

/** Each side's mark: the dot beside its label and the rail on the current page. */
export const SIDE_ACCENT: Record<Side, string> = { company: "bg-gold", venue: "bg-mint", operator: "bg-coral" };

/** Monogram: the brand mark, derived from the workspace name. */
export function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-plum-light text-gold grid size-7 shrink-0 place-items-center rounded-tile text-caption font-semibold",
        className
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The navigation for one side of the marketplace (company, venue or
 * operator): only that side's items, under its label, with the counts the
 * current page reports (nav-badges.tsx).
 */
export function Sidebar({
  workspaceName,
  side,
  allowedHrefs,
  collapsed,
  onToggle,
  onNavigate,
  onClose,
  className,
}: {
  workspaceName: string;
  side: Side;
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
  const tab = useSearchParams().get("tab");
  const badges = useNavBadges();
  const sections = sideSections(side, allowedHrefs);
  const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  return (
    <aside
      className={cn(
        "on-plum border-line flex h-full shrink-0 flex-col border-r transition-[width] duration-200 ease-out",
        collapsed ? "w-[3.75rem]" : "w-60",
        className
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
        <Link href={sideHome(side, allowedHrefs)} onClick={onNavigate} className="flex min-w-0 items-center gap-2.5 rounded-md">
          {collapsed || workspaceName !== "Lufer.ai" ? <Monogram name={workspaceName} /> : null}
          {/* The default workspace name gets the brand wordmark; a renamed workspace shows as typed. */}
          {!collapsed &&
            (workspaceName === "Lufer.ai" ? (
              <span className="font-display text-fg text-[1.3rem] leading-none font-semibold tracking-tight">
                Lufer<span className="text-coral font-sans text-[0.6em]">.ai</span>
              </span>
            ) : (
              <span className="text-fg truncate text-body font-semibold tracking-tight">{workspaceName}</span>
            ))}
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close navigation" className="btn btn-ghost btn-icon ml-auto size-8">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Which side of the marketplace this is. */}
      {collapsed ? (
        <span className={cn("mx-auto mb-1 block size-1.5 rounded-full", SIDE_ACCENT[side])} title={SIDES[side].label} aria-label={SIDES[side].label} role="img" />
      ) : (
        <p className="text-fg-muted mx-4 mb-1 flex items-center gap-2 text-caption font-medium">
          <span aria-hidden className={cn("size-1.5 rounded-full", SIDE_ACCENT[side])} />
          {SIDES[side].label}
        </p>
      )}

      <nav className="flex-1 overflow-y-auto px-2.5 pt-2 pb-4" aria-label={SIDES[side].label}>
        {sections.map((section, i) => (
          <div key={section.title ?? i} className={cn(i > 0 && "mt-5")}>
            {section.title &&
              (collapsed ? (
                <div className="border-line mx-3 mb-3 border-t" aria-hidden />
              ) : (
                <p className="label-mono mb-1.5 px-2.5">{section.title}</p>
              ))}
            {!section.title && i > 0 && collapsed ? <div className="border-line mx-3 mb-3 border-t" aria-hidden /> : null}
            <ul className="space-y-px">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = isItemActive(href, pathname, tab, hrefs);
                const badge = badges[href];
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      title={collapsed ? (badge ? `${label} (${badge.label})` : label) : badge?.title}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-meta font-medium transition-[color,background-color,box-shadow,transform] duration-150",
                        collapsed && "justify-center px-0",
                        active ? "bg-surface-raised text-fg" : "text-fg-subtle hover:bg-surface-raised hover:text-fg"
                      )}
                    >
                      {/* The side's colour marks the current page. */}
                      {active && <span aria-hidden className={cn("absolute top-2 bottom-2 -left-2.5 w-[3px] rounded-r-full", SIDE_ACCENT[side])} />}
                      <Icon
                        className={cn("size-[15px] shrink-0 transition-colors", active ? "text-fg" : "text-fg-faint group-hover:text-fg-muted")}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {collapsed ? (
                        <>
                          <span className="sr-only">
                            {label}
                            {badge ? ` (${badge.label})` : ""}
                          </span>
                          {badge ? <span aria-hidden className={cn("absolute top-1.5 right-2 size-1.5 rounded-full", badge.tone === "warning" ? "bg-gold" : "bg-fg-subtle")} /> : null}
                        </>
                      ) : (
                        <>
                          <span className="truncate">{label}</span>
                          {badge ? (
                            <span
                              className={cn(
                                "ml-auto shrink-0 rounded-full px-1.5 font-mono text-[11px] leading-[18px] tabular-nums",
                                badge.tone === "warning" ? "bg-gold text-plum" : "bg-surface-raised text-fg-muted"
                              )}
                            >
                              {badge.label}
                            </span>
                          ) : null}
                        </>
                      )}
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
              "text-fg-subtle hover:bg-surface-raised hover:text-fg flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-meta transition-[color,background-color,transform] duration-150",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-[15px]" strokeWidth={1.75} aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-[15px]" strokeWidth={1.75} aria-hidden />
                <span>Collapse</span>
                <kbd className="text-fg-subtle ml-auto text-caption">⌘B</kbd>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
