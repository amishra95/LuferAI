import Link from "next/link";
import { Building2, ClipboardCheck, ConciergeBell, LogOut, ShieldCheck, type LucideIcon } from "lucide-react";

import { signOut } from "@/app/login/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canAccess, type Portal } from "@/lib/auth/roles";
import { getCurrentMember } from "@/lib/auth/session";
import { dataSource } from "@/lib/data";
import { cn } from "@/lib/utils";

const PORTALS: { href: Portal; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Admin", icon: ShieldCheck },
  { href: "/client", label: "Client", icon: Building2 },
  { href: "/property", label: "Property", icon: ConciergeBell },
];

export type PortalKey = Portal | "/client/approvals";

export async function PortalShell({
  portal,
  title,
  subtitle,
  actions,
  children,
}: {
  portal: PortalKey;
  title: string;
  subtitle: string;
  /** Page-level actions shown beside the title (e.g. a drawer trigger). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const source = dataSource();
  const member = await getCurrentMember();

  // Only link to portals this role can open; approvers also get the approvals queue.
  const links: { href: PortalKey; label: string; icon: LucideIcon }[] = PORTALS.filter(({ href }) =>
    canAccess(member?.role, href)
  );
  if (member?.canApprove || member?.role === "ADMIN") {
    links.splice(links.findIndex((l) => l.href === "/client") + 1, 0, {
      href: "/client/approvals",
      label: "Approvals",
      icon: ClipboardCheck,
    });
  }
  const showBottomNav = links.length > 1;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="glass pt-safe sticky top-0 z-30 border-x-0 border-t-0">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-zinc-50 text-xs font-bold text-zinc-950 shadow-[0_0_18px_-4px] shadow-emerald-400/70">
              CH
            </span>
            <span className="hidden sm:inline">CorpHospitality</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:ml-3 md:flex" aria-label="Portals">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={href === portal ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-50",
                  href === portal && "bg-zinc-800 font-medium text-zinc-50"
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>

          <Badge variant={source === "mock" ? "warning" : "outline"} className="ml-auto border-zinc-700/70 text-zinc-400">
            {source === "mock" ? "Mock data" : "Live"}
          </Badge>

          {member ? (
            <form action={signOut} className="flex items-center gap-2">
              <span className="hidden text-sm text-zinc-400 lg:inline">{member.email}</span>
              <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
                <LogOut aria-hidden />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </form>
          ) : null}
        </div>
      </header>

      <main className={cn("mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8", showBottomNav && "max-md:pb-bottom-nav")}>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3 sm:mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{title}</h1>
            <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {children}
      </main>

      {showBottomNav ? (
        <nav
          aria-label="Portals"
          className="glass pb-safe fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0 md:hidden"
        >
          <ul className="mx-auto flex max-w-md">
            {links.map(({ href, label, icon: Icon }) => (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={href === portal ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-zinc-400",
                    href === portal && "text-zinc-50"
                  )}
                >
                  <Icon className={cn("size-5", href === portal && "drop-shadow-[0_0_6px_rgb(52_211_153/0.7)]")} aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
