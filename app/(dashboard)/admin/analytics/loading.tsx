import { PortalShell } from "@/components/portal/portal-shell";
import { ChartCardSkeleton, LoadingRegion, MetricSkeleton, Skeleton, TableSkeleton } from "@/components/portal/skeletons";

/**
 * Shown while the run log and traces load. Same shell, title and grid as the
 * page, so the real content replaces the placeholders in place.
 */
export default function Loading() {
  return (
    <PortalShell
      theme="concierge"
      title="Agent analytics"
      subtitle="Runs, reliability, latency and token use across every agent and channel, plus request traces."
      actions={
        <div aria-hidden className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-44 rounded-full" />
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-12 rounded-full" delay={i * 80} />
            ))}
          </div>
        </div>
      }
    >
      <LoadingRegion label="Loading agent analytics…">
        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <MetricSkeleton key={i} delay={i * 120} />
          ))}
        </section>
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <ChartCardSkeleton />
          <ChartCardSkeleton delay={150} />
        </div>
        <div className="panel mb-6 py-5 backdrop-blur-xl">
          <div className="mb-4 grid gap-2 px-5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="px-5">
            <TableSkeleton rows={4} columns={5} />
          </div>
        </div>
      </LoadingRegion>
    </PortalShell>
  );
}
