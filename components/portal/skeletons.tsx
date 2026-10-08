import { cn } from "@/lib/utils";

/*
 * Loading placeholders shaped like the real components (StatCard, chart
 * cards, tables) so nothing jumps when data arrives. Theme tokens throughout:
 * hairline white/10 borders and charcoal glass inside the concierge scope,
 * zinc on the light pages. Pulses are decorative (aria-hidden); wrap a screen
 * in LoadingRegion for a single announcement. Reduced motion stops the pulse
 * (globals.css).
 */

/** One pulsing bar or block. `delay` staggers neighbours into a gentle wave. */
export function Skeleton({ className, delay = 0 }: { className?: string; delay?: number }) {
  return <span aria-hidden className={cn("bg-surface-raised block animate-pulse rounded-md", className)} style={delay ? { animationDelay: `${delay}ms` } : undefined} />;
}

/** Announces "Loading …" once to assistive tech; everything inside is decorative. */
export function LoadingRegion({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden>{children}</div>
    </div>
  );
}

/** Same box as StatCard: label + icon row, 30px figure (24px off-scope), change pill and context. */
export function MetricSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="panel relative isolate flex flex-col overflow-hidden p-5 backdrop-blur-xl">
      <span aria-hidden className="pointer-events-none absolute -top-14 -right-12 -z-10 hidden size-40 animate-pulse rounded-full bg-white/5 blur-3xl concierge:block" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-2.5 w-20" delay={delay} />
        <Skeleton className="size-4 rounded-full" delay={delay} />
      </div>
      <Skeleton className="concierge:mt-5 concierge:h-[30px] mt-4 h-6 w-28" delay={delay + 80} />
      <div className="concierge:mt-3 mt-2.5 flex items-center gap-2">
        <Skeleton className="h-[22px] w-16 rounded-full" delay={delay + 160} />
        <Skeleton className="h-3 w-24" delay={delay + 160} />
      </div>
    </div>
  );
}

const BAR_HEIGHTS = [58, 72, 64, 80, 70, 86, 62];

/** Card with a title, description and a faint bar chart. */
export function ChartCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="panel flex flex-col gap-5 py-5 backdrop-blur-xl">
      <div className="grid gap-2 px-5">
        <Skeleton className="h-3.5 w-24" delay={delay} />
        <Skeleton className="h-3 w-40" delay={delay} />
      </div>
      <div className="border-line mx-5 flex h-60 items-end gap-[6%] border-b px-4 pb-px">
        {BAR_HEIGHTS.map((h, i) => (
          <div key={i} className="flex-1" style={{ height: `${h}%` }}>
            <Skeleton className="h-full rounded-t-md rounded-b-none" delay={delay + i * 90} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Table rows: a header strip and `rows` lines whose widths vary like real data. */
export function TableSkeleton({ rows = 5, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  const widths = ["w-40", "w-16", "w-12", "w-20", "w-14", "w-24"];
  return (
    <div className={cn("w-full", className)}>
      <div className="border-line flex h-11 items-center gap-6 border-b px-4">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className={cn("h-2.5", c === 0 ? "w-16" : "ml-auto w-10")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="border-line flex h-[3.25rem] items-center gap-6 border-b px-4 last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3", c === 0 ? widths[r % 2 === 0 ? 0 : 5] : cn("ml-auto", widths[(r + c) % widths.length]))} delay={r * 110} />
          ))}
        </div>
      ))}
    </div>
  );
}
