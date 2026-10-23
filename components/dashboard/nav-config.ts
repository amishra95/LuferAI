import { BarChart3, Bot, Building2, ClipboardCheck, ConciergeBell, Handshake, Landmark, LayoutDashboard, MapPinned, MessageSquare, Settings, ShieldCheck, UserCheck, UserCog } from "lucide-react";

import type { NavSection } from "@/types/navigation";

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/chat", label: "Chat", icon: MessageSquare },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/venues", label: "Venues", icon: MapPinned },
    ],
  },
  {
    title: "Portals",
    items: [
      { href: "/client", label: "Client", icon: Building2 },
      { href: "/client/approvals", label: "Approvals", icon: ClipboardCheck },
      { href: "/governance", label: "Governance", icon: Landmark },
      { href: "/property", label: "Property", icon: ConciergeBell },
      { href: "/partner", label: "Partner", icon: Handshake },
      { href: "/admin", label: "Admin", icon: ShieldCheck },
      { href: "/admin/approvals", label: "Account approvals", icon: UserCheck },
      { href: "/admin/managers", label: "Property managers", icon: UserCog },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Workspace",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

/** Cookie the server layout reads so the sidebar renders collapsed without a flash. */
export const SIDEBAR_COOKIE = "lufer_sidebar_collapsed";

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Label for a URL segment: the nav label when one matches, otherwise the segment title-cased. */
const ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function segmentLabel(href: string, segment: string): string {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((i) => i.href === href);
    if (item) return item.label;
  }
  // A record id reads as what it is, not as a title-cased UUID.
  if (ID_SEGMENT.test(segment)) return href.split("/").at(-2) === "events" ? "Event" : "Details";
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Path prefixes without a page of their own, and where their breadcrumb should go instead. */
const CRUMB_HREF: Record<string, string> = { "/client/events": "/client" };
export const crumbHref = (path: string) => CRUMB_HREF[path] ?? path;
