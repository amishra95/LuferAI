"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu } from "lucide-react";

import { signOut } from "@/app/login/actions";

import { segmentLabel } from "@/components/dashboard/nav-config";
import { Monogram } from "@/components/dashboard/sidebar";
import type { SystemMode } from "@/types/navigation";

export function Header({
  workspaceName,
  system,
  account,
  onOpenMobileNav,
}: {
  workspaceName: string;
  system: SystemMode;
  /** The signed-in user, or null when signed out / auth isn't configured. */
  account: { email: string | null } | null;
  onOpenMobileNav: () => void;
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((segment, i) => {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    return { href, label: segmentLabel(href, segment) };
  });

  return (
    <header className="border-line relative z-20 flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
      <button type="button" onClick={onOpenMobileNav} aria-label="Open navigation" className="btn btn-ghost btn-icon -ml-1.5 md:hidden">
        <Menu className="size-4" aria-hidden />
      </button>
      <Monogram name={workspaceName} className="md:hidden" />

      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-2 text-[13px]">
          <li className="hidden sm:block">
            <Link href="/dashboard" className="text-fg-subtle hover:text-fg transition-colors">
              {workspaceName}
            </Link>
          </li>
          {crumbs.map(({ href, label }, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={href}>
                <li aria-hidden className={i === 0 ? "text-fg-faint hidden font-mono sm:block" : "text-fg-faint font-mono"}>
                  /
                </li>
                <li className="min-w-0 truncate">
                  {last ? (
                    <span aria-current="page" className="text-fg font-medium">
                      {label}
                    </span>
                  ) : (
                    <Link href={href} className="text-fg-subtle hover:text-fg transition-colors">
                      {label}
                    </Link>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <Link
        href="/settings"
        title={system.mode === "live" ? "Chat is using a live model" : "No model key set — Chat runs scripted demo replies"}
        className={system.mode === "live" ? "pill pill-copper ml-auto hover:brightness-110" : "pill hover:text-fg ml-auto transition-colors"}
      >
        {system.mode === "live" ? (
          <>
            <span className="live-dot" aria-hidden />
            <span className="max-w-[9rem] truncate">{system.model}</span>
          </>
        ) : (
          <>
            <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden />
            demo mode
          </>
        )}
      </Link>

      {account ? (
        <form action={signOut} className="flex items-center gap-2">
          {account.email && <span className="text-fg-subtle hidden text-[12.5px] lg:inline">{account.email}</span>}
          <button type="submit" aria-label="Sign out" title="Sign out" className="btn btn-ghost btn-icon">
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      ) : null}
    </header>
  );
}
