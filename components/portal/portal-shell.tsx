import Link from "next/link";
import { Building2, Store } from "lucide-react";

import { NoticePill, Page, PageHeader } from "@/components/dashboard/page-header";
import { getCurrentMember } from "@/lib/auth/session";
import type { Portal } from "@/lib/auth/roles";
import { dataSource } from "@/lib/data";
import { cn } from "@/lib/utils";

export type PortalKey = Portal | "/client/approvals";

/** The supply-side portals an admin hops between; other roles can only open one of them. */
const SUPPLY_PORTALS = [
  { href: "/property", label: "Property view", icon: Building2 },
  { href: "/partner", label: "Partner extranet", icon: Store },
] as const;

function PortalSwitcher({ current }: { current: PortalKey }) {
  return (
    <nav aria-label="Switch portal" className="border-line bg-surface inline-flex rounded-md border p-0.5">
      {SUPPLY_PORTALS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-meta transition-colors", current === href ? "bg-surface-raised text-fg" : "text-fg-subtle hover:text-fg")}
        >
          <Icon className="size-3.5" aria-hidden /> {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Frame for the client, property and admin portals. They render inside the
 * dashboard shell (sidebar + header), so this only adds the shared page width,
 * header and the data-source notice. Platform admins (the one role that can
 * open both) get a Property view / Partner extranet switcher on those portals.
 */
export async function PortalShell({
  portal,
  title,
  subtitle,
  actions,
  children,
}: {
  /** The portal this page belongs to (navigation lives in the dashboard sidebar). */
  portal?: PortalKey;
  title: string;
  subtitle: string;
  /** Page-level actions shown beside the title (e.g. a drawer trigger). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const source = dataSource();
  // Operator-only chrome: the data-source badge and the portal switcher.
  const admin = (await getCurrentMember())?.role === "ADMIN";
  const switcher = admin && (portal === "/property" || portal === "/partner");
  return (
    <Page>
      <PageHeader
        title={title}
        description={subtitle}
        badge={admin ? <NoticePill>{source === "mock" ? "mock data" : source}</NoticePill> : undefined}
        actions={
          switcher ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <PortalSwitcher current={portal!} />
              {actions}
            </div>
          ) : (
            actions
          )
        }
      />
      {children}
    </Page>
  );
}
