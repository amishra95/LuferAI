import { Page } from "@/components/dashboard/page-header";
import { LoadingRegion, Skeleton, TableSkeleton } from "@/components/portal/skeletons";

/** The client portal's frame while bookings, approvals and POs load: tabs, status tiles, concierge, bookings table. */
export default function Loading() {
  return (
    <Page>
      <LoadingRegion label="Loading the client portal…">
        <div className="mb-8 grid gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-80 max-w-full" delay={80} />
        </div>
        <div className="border-line mb-6 flex gap-4 border-b pb-3">
          {["w-16", "w-[72px]", "w-20", "w-28"].map((w, i) => (
            <Skeleton key={w} className={`h-3.5 ${w}`} delay={i * 60} />
          ))}
        </div>
        <div className="mb-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel grid gap-2.5 p-5">
              <Skeleton className="h-2.5 w-20" delay={i * 80} />
              <Skeleton className="h-5 w-8" delay={i * 80 + 60} />
            </div>
          ))}
        </div>
        <div className="panel mb-10 grid gap-3 p-5">
          <Skeleton className="h-3.5 w-40" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-7 w-64 rounded-full" delay={i * 90} />
            ))}
          </div>
        </div>
        <section className="panel overflow-hidden">
          <TableSkeleton rows={6} columns={6} />
        </section>
      </LoadingRegion>
    </Page>
  );
}
