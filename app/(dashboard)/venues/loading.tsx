import { Page, PageHeader } from "@/components/dashboard/page-header";
import { LoadingRegion, Skeleton } from "@/components/portal/skeletons";

/** Shown while venues load: the filter row and venue cards, the same frame as the company view. */
export default function Loading() {
  return (
    <Page>
      <PageHeader title="Venues" />
      <LoadingRegion label="Loading venues…">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-64" delay={60} />
          <Skeleton className="h-8 w-36" delay={120} />
          <Skeleton className="ml-auto h-8 w-40" delay={180} />
        </div>
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="bg-surface border-frame overflow-hidden rounded-[var(--radius-card)] border">
              <Skeleton className="aspect-video w-full rounded-none" delay={i * 80} />
              <div className="grid gap-2 p-4">
                <Skeleton className="h-4 w-40" delay={i * 80} />
                <Skeleton className="h-3 w-28" delay={i * 80} />
                <div className="mt-1 flex gap-1.5">
                  <Skeleton className="h-6 w-28 rounded-full" delay={i * 80} />
                  <Skeleton className="h-6 w-20 rounded-full" delay={i * 80} />
                </div>
              </div>
              <div className="border-line flex items-center justify-between border-t px-4 py-3">
                <Skeleton className="h-3.5 w-24" delay={i * 80} />
                <Skeleton className="h-8 w-32" delay={i * 80} />
              </div>
            </li>
          ))}
        </ul>
      </LoadingRegion>
    </Page>
  );
}
