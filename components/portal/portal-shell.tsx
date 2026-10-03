import Link from "next/link";
import { Building2, ConciergeBell, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { dataSource } from "@/lib/data";
import { cn } from "@/lib/utils";

const PORTALS = [
  { href: "/admin", label: "Admin", icon: ShieldCheck },
  { href: "/client", label: "Client", icon: Building2 },
  { href: "/property", label: "Property", icon: ConciergeBell },
] as const;

export type PortalKey = (typeof PORTALS)[number]["href"];

export function PortalShell({
  portal,
  title,
  subtitle,
  children,
}: {
  portal: PortalKey;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const source = dataSource();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-card/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-xs font-bold">
              CH
            </span>
            <span className="hidden sm:inline">CorpHospitality</span>
          </Link>

          <nav className="flex items-center gap-1 sm:ml-2" aria-label="Portals">
            {PORTALS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={href === portal ? "page" : undefined}
                className={cn(
                  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  href === portal && "bg-accent text-accent-foreground font-medium"
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{label}</span>
              </Link>
            ))}
          </nav>

          <Badge variant={source === "mock" ? "warning" : "success"} className="ml-auto">
            {source === "mock" ? "Mock data" : "Supabase"}
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
