"use client";

import { useSyncExternalStore } from "react";

import { SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const DESKTOP = "(min-width: 768px)";

function useIsDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true
  );
}

/**
 * Sheet content that docks right on desktop and becomes a glass bottom sheet on
 * phones (thumb-reachable, safe-area padded, capped at 88% of the viewport).
 */
export function ResponsiveSheetContent({
  className,
  children,
  wide = false,
  ...props
}: React.ComponentProps<typeof SheetContent> & { wide?: boolean }) {
  const desktop = useIsDesktop();
  return (
    <SheetContent
      side={desktop ? "right" : "bottom"}
      className={cn(
        "gap-0 p-0",
        desktop
          ? // Full-height side drawer: clear the status bar (iPad / landscape shells).
            cn("pt-safe pb-safe w-full border-line/60 bg-surface", wide ? "sm:max-w-xl" : "sm:max-w-md")
          : // Never taller than the space under the status bar.
            "glass pb-safe max-h-[min(88dvh,calc(100dvh-var(--app-safe-top)-0.75rem))] rounded-t-2xl border-x-0 border-b-0",
        className
      )}
      {...props}
    >
      {!desktop ? <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-surface-raised" /> : null}
      {children}
    </SheetContent>
  );
}
