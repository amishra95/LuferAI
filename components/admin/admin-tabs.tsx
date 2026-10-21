import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/managers", label: "Property managers" },
  { href: "/admin/analytics", label: "Agent analytics" },
] as const;

/** Section tabs across the admin portal's pages. */
export function AdminTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="border-line mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Admin sections">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={current === t.href ? "page" : undefined}
          className={cn(
            "relative -mb-px inline-flex h-10 shrink-0 items-center px-3 text-meta transition-colors",
            current === t.href ? "text-fg font-medium" : "text-fg-subtle hover:text-fg"
          )}
        >
          {t.label}
          {current === t.href && <span aria-hidden className="bg-link absolute inset-x-2 bottom-0 h-[2px] rounded-full" />}
        </Link>
      ))}
    </nav>
  );
}
