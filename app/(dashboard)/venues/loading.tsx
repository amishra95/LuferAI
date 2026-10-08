import { Page, PageHeader } from "@/components/dashboard/page-header";
import { LoadingRegion, Skeleton, TableSkeleton } from "@/components/portal/skeletons";

/** Shown while the directory (own venues + partner network) loads; same frame as the page. */
export default function Loading() {
  return (
    <Page>
      <PageHeader
        title="Venues"
        description="Lufer.ai's own venues plus federated partner listings — the directory the agent's searchVenues tool queries."
      />
      <LoadingRegion label="Loading venues…">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* Search, area, tier, PDR, min guests, Apply: the same widths as the form. */}
          <Skeleton className="h-9 w-full sm:w-64" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-36" delay={i * 80} />
          ))}
          <Skeleton className="h-9 w-28" delay={240} />
          <Skeleton className="h-9 w-16" delay={320} />
        </div>
        <section className="panel overflow-hidden">
          {/* Phones: stacked rows, like the page. */}
          <div className="md:hidden">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-line grid gap-2 border-b px-4 py-3.5 last:border-b-0">
                <div className="flex justify-between gap-3">
                  <Skeleton className="h-3.5 w-40" delay={i * 110} />
                  <Skeleton className="h-3.5 w-16" delay={i * 110} />
                </div>
                <Skeleton className="h-3 w-56" delay={i * 110} />
              </div>
            ))}
          </div>
          <TableSkeleton rows={8} columns={6} className="hidden md:block" />
          <div className="border-line border-t px-5 py-3">
            <Skeleton className="h-3 w-24" />
          </div>
        </section>
      </LoadingRegion>
    </Page>
  );
}
