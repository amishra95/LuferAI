import { LoadingRegion, Skeleton } from "@/components/portal/skeletons";

/** The RFP card and quote form's shape while the link loads. */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(1.5rem+var(--app-safe-top))] pb-[calc(6rem+var(--app-safe-bottom))]">
      <LoadingRegion label="Loading the request…">
        <div className="panel grid gap-4 p-6">
          <Skeleton className="h-2.5 w-32" />
          <Skeleton className="h-6 w-60" delay={80} />
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" delay={140 + i * 60} />
            ))}
          </div>
        </div>
        <div className="panel mt-4 grid gap-4 p-6">
          <Skeleton className="h-12 w-full" delay={400} />
          <Skeleton className="h-10 w-full" delay={460} />
        </div>
      </LoadingRegion>
    </main>
  );
}
