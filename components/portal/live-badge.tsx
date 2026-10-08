import { cn } from "@/lib/utils";

const CLOCK = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * "LIVE · as of 14:32 IST" with a pinging status ring: emerald when every
 * source loaded, amber ("PARTIAL") when some didn't. The page is rendered per
 * request, so the time is when this view was built, not a running clock.
 */
export function LiveBadge({ asOf, partial = false, className }: { asOf: Date; partial?: boolean; className?: string }) {
  const tone = partial ? "bg-amber-400 shadow-amber-400/70" : "bg-emerald-400 shadow-emerald-400/70";
  return (
    <span
      title={partial ? "Some sources couldn't be loaded; figures may be incomplete. Reload for newer data." : "Built from the run log when this page loaded. Reload for newer data."}
      className={cn("border-line bg-surface inline-flex h-7 items-center gap-2 rounded-full border px-3 font-mono text-[11px] tracking-wider tabular-nums", className)}
    >
      <span aria-hidden className="relative flex size-2">
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", partial ? "bg-amber-400" : "bg-emerald-400")} />
        <span className={cn("relative inline-flex size-2 rounded-full shadow-[0_0_8px]", tone)} />
      </span>
      <span className={partial ? "text-amber-800 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>{partial ? "PARTIAL" : "LIVE"}</span>
      <span className="text-fg-subtle">· as of {CLOCK.format(asOf)} IST</span>
    </span>
  );
}
