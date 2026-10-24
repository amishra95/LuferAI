import type { LucideIcon } from "lucide-react";

export type NavItem = {
  /** May carry ?tab=… to open a section of a portal page. */
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only when this exact href is allowed (a permission-gated section), not just its path. */
  gated?: boolean;
};

/** Which side of the marketplace a page belongs to (components/dashboard/nav-config.ts). */
export type Side = "company" | "venue" | "operator";

/** A count on a sidebar item, set by the page that knows it (components/dashboard/nav-badges.tsx). */
export type NavBadge = { label: string; tone?: "warning" | "neutral"; title?: string };

export type NavSection = {
  /** Omit for an untitled leading section. */
  title?: string;
  items: NavItem[];
};

/** Whether chat talks to a real model; shown in the header. */
export type SystemMode = { mode: "live"; model: string } | { mode: "demo" };
