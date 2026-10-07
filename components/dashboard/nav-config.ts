import { Bot, Building2, ClipboardCheck, ConciergeBell, LayoutDashboard, MapPinned, MessageSquare, Settings, ShieldCheck } from "lucide-react";

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
      { href: "/property", label: "Property", icon: ConciergeBell },
      { href: "/admin", label: "Admin", icon: ShieldCheck },
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
export function segmentLabel(href: string, segment: string): string {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((i) => i.href === href);
    if (item) return item.label;
  }
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
