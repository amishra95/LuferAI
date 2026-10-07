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

/** Whether chat talks to a real model; shown in the header. */
export type SystemMode = { mode: "live"; model: string } | { mode: "demo" };
