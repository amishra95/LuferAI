import Link from "next/link";

import { SPEND_TABS } from "@/components/dashboard/nav-config";
import { cn } from "@/lib/utils";

type SpendHref = (typeof SPEND_TABS)[number]["href"];

/**
 * Tabs across the Spend area (one sidebar item): overview, purchase orders,
 * invoices & GST, statements and ROI live on different routes but read as one place.
 * `query` carries ?company=… for admins viewing a company.
 */
export function SpendTabs({ active, query }: { active: SpendHref; query?: string }) {
  return (
    <nav className="border-line -mx-1 mb-6 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none]" aria-label="Spend">
      {SPEND_TABS.map((t) => {
        const current = t.href === active;
        const href = query ? `${t.href}${t.href.includes("?") ? "&" : "?"}${query}` : t.href;
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex h-10 shrink-0 items-center px-3 text-meta whitespace-nowrap transition-colors",
              current ? "text-fg font-medium" : "text-fg-subtle hover:text-fg"
            )}
          >
            {t.label}
            {current && <span aria-hidden className="bg-link absolute inset-x-2 bottom-0 h-[2px] rounded-full" />}
          </Link>
        );
      })}
    </nav>
  );
}
