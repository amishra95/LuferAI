import { cn } from "@/lib/utils";

/**
 * Segmented "viewing as" chip used by the portals' demo switchers (company,
 * user, venue, tenant). The selected chip is solid charcoal; the rest are
 * quiet outlined pills.
 */
export function segmentClass(active: boolean) {
  return cn(
    "inline-flex h-7 items-center rounded-full border px-3 text-[12.5px] transition-colors",
    active
      ? "border-fg bg-fg text-white shadow-[0_1px_2px_rgb(9_9_11/0.15)]"
      : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg"
  );
}
