import { Page } from "@/components/dashboard/page-header";
import { LoadingRegion, Skeleton, TableSkeleton } from "@/components/portal/skeletons";

/** The event workspace's frame: RSVP tiles, the guest list, and the schedule / activity / invite column. */
export default function Loading() {
  return (
    <Page>
      <LoadingRegion label="Loading the event workspace…">
        <div className="mb-8 grid gap-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-3.5 w-96 max-w-full" delay={80} />
        </div>
        <div className="mb-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-line grid gap-2 rounded-md border px-3 py-2.5">
              <Skeleton className="h-2.5 w-14" delay={i * 80} />
              <Skeleton className="h-5 w-8" delay={i * 80 + 60} />
              <Skeleton className="h-2.5 w-24" delay={i * 80 + 120} />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="panel grid gap-4 p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-20 w-full" delay={80} />
            <TableSkeleton rows={5} columns={4} />
          </div>
          <div className="grid content-start gap-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="panel grid gap-3 p-5">
                <Skeleton className="h-4 w-24" delay={i * 100} />
                <Skeleton className="h-3 w-full" delay={i * 100 + 60} />
                <Skeleton className="h-3 w-3/4" delay={i * 100 + 120} />
              </div>
            ))}
          </div>
        </div>
      </LoadingRegion>
    </Page>
  );
}
