import { cn } from "@/lib/utils";

/** Standard page frame: one width, one gutter, one vertical rhythm for every module. */
export function Page({ children, width = "default" }: { children: React.ReactNode; width?: "default" | "narrow" }) {
  return (
    <div className={cn("mx-auto w-full px-4 pt-6 pb-12 sm:px-6 sm:pt-8", width === "narrow" ? "max-w-4xl" : "max-w-6xl")}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 data-slot="page-title" className="text-fg flex flex-wrap items-center gap-2.5 text-lg font-semibold tracking-tight">
          {title}
          {badge}
        </h1>
        <p data-slot="page-description" className="text-fg-subtle mt-1 text-[13px]">{description}</p>
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

/** Section heading inside a page: mono label with an optional trailing element. */
export function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="label-mono">{children}</h2>
      {aside}
    </div>
  );
}
