import type { LucideIcon } from "lucide-react";

/** Headline metric for the portals, styled like the dashboard's telemetry cards. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="label-mono">{label}</p>
        {Icon ? <Icon className="text-fg-faint size-4" strokeWidth={1.75} aria-hidden /> : null}
      </div>
      <p className="text-fg concierge:mt-5 concierge:text-[30px] mt-4 font-mono text-[24px] leading-none font-medium tracking-[-0.03em] tabular-nums">{value}</p>
      {hint ? <p className="text-fg-subtle concierge:mt-3 concierge:leading-5 mt-2.5 text-[12px]">{hint}</p> : null}
    </div>
  );
}
