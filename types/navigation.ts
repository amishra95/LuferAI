import type { LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavSection = {
  /** Omit for an untitled leading section. */
  title?: string;
  items: NavItem[];
};
