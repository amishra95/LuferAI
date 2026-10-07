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
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
          {title}
          {badge}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      </div>
      {actions}
    </div>
  );
}

/** Small mono pill for page-level notices ("Sample data", "In memory"). */
export function NoticePill({ children, tone = "amber" }: { children: React.ReactNode; tone?: "amber" | "zinc" }) {
  const cls =
    tone === "amber"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
      : "border-zinc-700 bg-zinc-800/60 text-zinc-400";
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] font-normal ${cls}`}>{children}</span>;
}
