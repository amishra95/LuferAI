import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileText,
  Inbox,
  Landmark,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  MessagesSquare,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tags,
  UserCheck,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

import type { NavSection, Side } from "@/types/navigation";

/**
 * The app has two sides, like the marketplace it runs: companies that book
 * events, and venues that host them (Lufer.ai's own venues and partner
 * suppliers share the venue side). Lufer.ai staff get a third, Operator.
 * Everyone sees only their own side's sidebar; admins switch sides with
 * "View as" in the header.
 *
 * An item's href may carry ?tab=…: it opens that section of a portal page.
 * gated items need their exact href in the allowed list (partner permissions);
 * the rest need only their path.
 */
export const SIDES: Record<Side, { label: string; sections: NavSection[] }> = {
  company: {
    label: "For companies",
    sections: [
      {
        items: [
          { href: "/client", label: "Events", icon: CalendarDays },
          { href: "/venues", label: "Find venues", icon: MapPinned },
          { href: "/chat", label: "Concierge", icon: MessageSquare },
        ],
      },
      {
        title: "Approvals",
        items: [
          { href: "/client?tab=signoffs", label: "Sign-offs", icon: ClipboardList },
          { href: "/client/approvals", label: "To approve", icon: ClipboardCheck },
        ],
      },
      {
        title: "Spend",
        items: [
          { href: "/client?tab=catalog", label: "Catalogue", icon: ShoppingBag },
          { href: "/client?tab=pos", label: "Purchase orders", icon: FileText },
          { href: "/client?tab=settlement", label: "Settlement", icon: Receipt },
        ],
      },
      {
        title: "Company",
        items: [
          { href: "/governance", label: "Policies", icon: Landmark },
          { href: "/contracts", label: "Contracts", icon: FileSignature },
        ],
      },
    ],
  },
  venue: {
    label: "For venues",
    sections: [
      // Lufer.ai's own venues (property managers).
      {
        title: "Bookings",
        items: [
          { href: "/property", label: "Requests & holds", icon: Inbox },
          { href: "/property?tab=inquiries", label: "Inquiries", icon: MessagesSquare },
          { href: "/property?tab=briefs", label: "Event briefs", icon: ClipboardList },
          { href: "/property?tab=accounts", label: "Clients", icon: Users },
        ],
      },
      {
        title: "Money",
        items: [
          { href: "/property?tab=pricing", label: "Pricing", icon: Tags },
          { href: "/property?tab=payouts", label: "Payouts & history", icon: Wallet },
        ],
      },
      // Partner suppliers (the extranet).
      {
        title: "Listings",
        items: [
          { href: "/partner", label: "Listings", icon: Store },
          { href: "/partner?tab=rates", label: "Rate cards", icon: Tags },
          { href: "/partner?tab=catalog", label: "Catalogue", icon: Package },
        ],
      },
      {
        title: "Orders",
        items: [
          { href: "/partner?tab=orders", label: "Orders", icon: ShoppingCart },
          { href: "/partner?tab=payouts", label: "Payouts", icon: Wallet, gated: true },
        ],
      },
      {
        title: "Team",
        items: [
          { href: "/partner?tab=team", label: "Members", icon: Users, gated: true },
          { href: "/partner?tab=activity", label: "Activity", icon: Activity, gated: true },
        ],
      },
      {
        title: "Documents",
        items: [{ href: "/contracts", label: "Contracts", icon: FileSignature }],
      },
    ],
  },
  operator: {
    label: "Operator",
    sections: [
      {
        items: [
          { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
          { href: "/admin", label: "Marketplace", icon: ShieldCheck },
          { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
        ],
      },
      {
        title: "People",
        items: [
          { href: "/admin/approvals", label: "Account approvals", icon: UserCheck },
          { href: "/admin/managers", label: "Venue managers", icon: UserCog },
        ],
      },
      {
        title: "Directory & AI",
        items: [
          { href: "/venues", label: "Venues", icon: MapPinned },
          { href: "/agents", label: "Agents", icon: Bot },
          { href: "/chat", label: "Chat", icon: MessageSquare },
        ],
      },
      {
        items: [{ href: "/settings", label: "Settings", icon: Settings }],
      },
    ],
  },
};

export const SIDE_ORDER: readonly Side[] = ["company", "venue", "operator"];

/** Paths that belong to one side; shared pages (/venues, /chat, /contracts) take the viewer's side. */
const SIDE_PATHS: Record<Side, readonly string[]> = {
  company: ["/client", "/governance"],
  venue: ["/property", "/partner"],
  operator: ["/dashboard", "/admin", "/agents", "/settings"],
};

export function sideForPath(pathname: string): Side | null {
  return SIDE_ORDER.find((s) => SIDE_PATHS[s].some((p) => isActive(pathname, p))) ?? null;
}

/** The side a role lives on; admins start on Operator. */
export function sideForRole(role: string | null | undefined): Side {
  return role === "CLIENT" ? "company" : role === "PROPERTY" || role === "PARTNER" ? "venue" : "operator";
}

const pathOf = (href: string) => href.split("?")[0];
export const tabOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "").get("tab");

/** A side's sections, with only the items this user may open. */
export function sideSections(side: Side, allowedHrefs: readonly string[]): NavSection[] {
  const allowed = new Set(allowedHrefs);
  return SIDES[side].sections
    .map((s) => ({ ...s, items: s.items.filter((i) => allowed.has(pathOf(i.href)) && (!i.gated || allowed.has(i.href))) }))
    .filter((s) => s.items.length > 0);
}

/**
 * The sides this user belongs on (admins: all three): those with a page of
 * their own the user may open. Shared pages alone (a client's /contracts is
 * also on the venue side) don't make a side theirs.
 */
export function visibleSides(allowedHrefs: readonly string[]): Side[] {
  return SIDE_ORDER.filter((s) => sideSections(s, allowedHrefs).some((sec) => sec.items.some((i) => sideForPath(pathOf(i.href)) === s)));
}

/** Where a side starts for this user: its first item they may open. */
export function sideHome(side: Side, allowedHrefs: readonly string[]): string {
  return sideSections(side, allowedHrefs)[0]?.items[0]?.href ?? "/";
}

/**
 * Whether an item is the current page: same path and same ?tab (an item
 * without a tab is the page's default section). Pages below an item without
 * one of their own (/client/events/…) light up that item.
 */
export function isItemActive(href: string, pathname: string, tab: string | null, allHrefs: readonly string[]): boolean {
  const path = pathOf(href);
  if (pathname === path) return tabOf(href) === tab;
  return isActive(pathname, path) && !allHrefs.some((h) => pathOf(h).length > path.length && isActive(pathname, pathOf(h)));
}

/** Every nav item once, for the command palette. */
export const ALL_NAV_ITEMS = SIDE_ORDER.flatMap((side) => SIDES[side].sections.flatMap((s) => s.items.map((i) => ({ ...i, side, section: s.title }))))
  .filter((i, n, all) => all.findIndex((x) => x.href === i.href) === n);

/** Cookie the server layout reads so the sidebar renders collapsed without a flash. */
export const SIDEBAR_COOKIE = "lufer_sidebar_collapsed";
/** The side an admin last viewed, so shared pages (/venues, /chat) keep that sidebar. */
export const SIDE_COOKIE = "lufer_side";

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Breadcrumb names for paths that aren't (only) a nav item. */
const PATH_LABEL: Record<string, string> = {
  "/client": "Company",
  "/client/approvals": "To approve",
  "/property": "Venue",
  "/partner": "Supplier",
  "/admin": "Operator",
  "/admin/approvals": "Account approvals",
  "/admin/managers": "Venue managers",
  // Shared pages: neutral names, since their sidebar label differs by side.
  "/venues": "Venues",
  "/chat": "Chat",
};

/** Label for a URL segment: a known path's name, otherwise the segment title-cased. */
const ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function segmentLabel(href: string, segment: string): string {
  const known = PATH_LABEL[href] ?? ALL_NAV_ITEMS.find((i) => i.href === href)?.label;
  if (known) return known;
  // A record id reads as what it is, not as a title-cased UUID.
  if (ID_SEGMENT.test(segment)) return href.split("/").at(-2) === "events" ? "Event" : "Details";
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Path prefixes without a page of their own, and where their breadcrumb should go instead. */
const CRUMB_HREF: Record<string, string> = { "/client/events": "/client" };
export const crumbHref = (path: string) => CRUMB_HREF[path] ?? path;
