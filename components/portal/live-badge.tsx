import { cn } from "@/lib/utils";

const CLOCK = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * "● Live · 14:32 IST": a solid green dot when every source loaded, amber
 * ("Partial") when some didn't. The page is rendered per request, so the time
 * is when this view was built, not a running clock.
 */
export function LiveBadge({ asOf, partial = false, className }: { asOf: Date; partial?: boolean; className?: string }) {
  return (
    <span
      title={partial ? "Some sources couldn't be loaded; figures may be incomplete. Reload for newer data." : "Built from the run log when this page loaded. Reload for newer data."}
      className={cn("text-fg-subtle inline-flex h-7 items-center gap-2 font-mono text-[11px] tabular-nums", className)}
    >
      <span aria-hidden className={cn("status-dot", partial ? "bg-warn" : "bg-sage")} />
      <span className="text-fg-muted">{partial ? "Partial" : "Live"}</span>
      <span>· {CLOCK.format(asOf)} IST</span>
    </span>
  );
}
