import { Page } from "@/components/dashboard/page-header";
import { LoadingRegion, MetricSkeleton, Skeleton } from "@/components/portal/skeletons";

/** The partner extranet's frame while listings, orders and payouts load: summary tiles, tabs and a board. */
export default function Loading() {
  return (
    <Page>
      <LoadingRegion label="Loading the partner extranet…">
        <div className="mb-8 grid gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-72 max-w-full" delay={80} />
        </div>
        <div className="mb-6 grid gap-6 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <MetricSkeleton key={i} delay={i * 90} />
          ))}
        </div>
        <div className="border-line mb-6 flex gap-5 border-b pb-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-3.5 w-16" delay={i * 60} />
          ))}
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((col) => (
            <div key={col} className="border-line grid w-[18rem] shrink-0 content-start gap-2 rounded-lg border p-2 lg:w-auto lg:flex-1">
              <Skeleton className="m-1.5 h-2.5 w-20" delay={col * 80} />
              {Array.from({ length: col === 0 ? 3 : 2 - (col % 2) }, (_, i) => (
                <div key={i} className="panel grid gap-2 p-5">
                  <Skeleton className="h-3.5 w-32" delay={col * 80 + i * 110} />
                  <Skeleton className="h-3 w-44" delay={col * 80 + i * 110} />
                  <Skeleton className="h-6 w-20" delay={col * 80 + i * 110 + 60} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </LoadingRegion>
    </Page>
  );
}
