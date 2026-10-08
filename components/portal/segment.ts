import { cn } from "@/lib/utils";

/**
 * Segmented "viewing as" chip used by the portals' demo switchers (company,
 * user, venue, tenant). The selected chip is solid charcoal; the rest are
 * quiet outlined pills.
 */
export function segmentClass(active: boolean) {
  return cn(
    "inline-flex h-7 items-center rounded-full border px-3 text-[12.5px] transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out active:scale-[0.98] pointer-coarse:min-h-11 pointer-coarse:px-4 concierge:h-8 concierge:px-3.5 concierge:font-mono concierge:text-[11.5px] concierge:tracking-wider",
    active
      ? "border-fg bg-fg text-canvas shadow-[0_1px_2px_rgb(9_9_11/0.15)] dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-200 dark:shadow-[0_0_16px_-6px_rgb(245_158_11/0.6)]"
      : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg"
  );
}
