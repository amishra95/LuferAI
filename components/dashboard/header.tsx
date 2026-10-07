"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Slash } from "lucide-react";

import { segmentLabel } from "@/components/dashboard/nav-config";

export function Header({ workspaceName, onOpenMobileNav }: { workspaceName: string; onOpenMobileNav: () => void }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((segment, i) => {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    return { href, label: segmentLabel(href, segment) };
  });

  return (
    <header className="bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="text-muted-foreground hover:bg-secondary hover:text-foreground -ml-1 grid size-8 place-items-center rounded-md md:hidden"
      >
        <Menu className="size-4" aria-hidden />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1.5 text-sm">
          <li>
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
              {workspaceName}
            </Link>
          </li>
          {crumbs.map(({ href, label }, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={href}>
                <li aria-hidden className="text-muted-foreground/50">
                  <Slash className="size-3.5 -rotate-12" />
                </li>
                <li className="min-w-0 truncate">
                  {last ? (
                    <span aria-current="page" className="text-foreground font-medium">
                      {label}
                    </span>
                  ) : (
                    <Link href={href} className="text-muted-foreground hover:text-foreground transition-colors">
                      {label}
                    </Link>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
    </header>
  );
}
