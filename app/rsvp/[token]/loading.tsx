import { LoadingRegion, Skeleton } from "@/components/portal/skeletons";

/** The invitation card's shape while the guest's invite loads. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 pt-[calc(3rem+var(--app-safe-top))] pb-[calc(3rem+var(--app-safe-bottom))]">
      <LoadingRegion label="Loading your invitation…">
        <div className="panel grid gap-4 p-6">
          <Skeleton className="h-2.5 w-40" />
          <Skeleton className="h-6 w-64" delay={80} />
          <Skeleton className="h-3.5 w-56" delay={140} />
          <Skeleton className="h-3.5 w-48" delay={200} />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11" delay={260 + i * 60} />
            ))}
          </div>
          <Skeleton className="ml-auto h-11 w-32" delay={440} />
        </div>
      </LoadingRegion>
    </main>
  );
}
