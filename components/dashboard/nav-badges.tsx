"use client";

import { createContext, useContext, useEffect, useState } from "react";

import type { NavBadge } from "@/types/navigation";

type Badges = Record<string, NavBadge>;
const BadgeContext = createContext<{ badges: Badges; set: (badges: Badges | null) => void }>({ badges: {}, set: () => {} });

/** Holds the counts the current page puts on sidebar items. */
export function NavBadgeProvider({ children }: { children: React.ReactNode }) {
  const [badges, setBadges] = useState<Badges>({});
  return <BadgeContext.Provider value={{ badges, set: (b) => setBadges(b ?? {}) }}>{children}</BadgeContext.Provider>;
}

export const useNavBadges = () => useContext(BadgeContext).badges;

/**
 * Rendered by a page to badge sidebar items by href, e.g.
 * { "/client?tab=signoffs": { label: "2 for you", tone: "warning" } }.
 * Cleared when the page unmounts.
 */
export function NavBadges({ badges }: { badges: Badges }) {
  const { set } = useContext(BadgeContext);
  const key = JSON.stringify(badges);
  useEffect(() => {
    set(JSON.parse(key) as Badges);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
