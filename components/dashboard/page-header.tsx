import { cn } from "@/lib/utils";

/** Standard page frame: one width (max-w-7xl), one gutter, one vertical rhythm for every module. */
export function Page({ children, width = "default" }: { children: React.ReactNode; width?: "default" | "narrow" }) {
  return (
    <div className={cn("pt-8 pb-12 lg:pt-10 lg:pb-20", width === "narrow" ? "mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8" : "container-app")}>
      {children}
    </div>
  );
}

/**
 * Page title. No taglines: the title and the content explain the page.
 * `meta` is for facts about the record on screen (date, venue, parties), never prose.
 */
export function PageHeader({
  title,
  meta,
  badge,
  actions,
}: {
  title: string;
  meta?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 data-slot="page-title" className="text-fg text-title font-display flex flex-wrap items-center gap-2.5 font-semibold">
          {title}
          {badge}
        </h1>
        {meta ? <p data-slot="page-meta" className="text-fg-subtle text-body mt-1">{meta}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** Quiet page-level notice ("sample data", "in memory"). Neutral by design. */
export function NoticePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="pill font-normal">
      <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden />
      {children}
    </span>
  );
}

/** Section heading inside a page, with an optional trailing element. */
export function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-fg text-section font-semibold">{children}</h2>
      {aside}
    </div>
  );
}
