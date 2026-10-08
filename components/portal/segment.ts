import { cn } from "@/lib/utils";

/**
 * Segmented chip for the portals' switchers (company, venue, tenant) and
 * time ranges. The selected chip is a raised fill with full-contrast text;
 * the rest are plain text that brightens on hover.
 */
export function segmentClass(active: boolean) {
  return cn(
    "inline-flex h-7 items-center rounded-md border px-2.5 text-[12.5px] transition-colors duration-100 pointer-coarse:min-h-11 pointer-coarse:px-3.5",
    active ? "border-line-strong bg-surface-raised text-fg" : "text-fg-subtle hover:text-fg border-transparent"
  );
}
