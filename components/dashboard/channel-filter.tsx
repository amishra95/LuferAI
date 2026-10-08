import Link from "next/link";

import { cn } from "@/lib/utils";
import type { TaskChannel } from "@/types/channels";

export type ChannelFilterValue = TaskChannel | "all";

const OPTIONS: { value: ChannelFilterValue; label: string }[] = [
  { value: "all", label: "All channels" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "slack", label: "Slack" },
  { value: "web", label: "Web" },
];

/**
 * Segmented control for the activity stream. Plain links (?channel=…), so the
 * filter works without JS, survives refresh and can be shared.
 */
export function ChannelFilter({ value, counts }: { value: ChannelFilterValue; counts: Record<ChannelFilterValue, number> }) {
  return (
    <nav aria-label="Filter activity by channel" className="bg-surface-raised inline-flex max-w-full overflow-x-auto rounded-[10px] p-0.5">
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <Link
            key={o.value}
            href={o.value === "all" ? "/dashboard" : `/dashboard?channel=${o.value}`}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] whitespace-nowrap transition-colors",
              active ? "bg-surface text-fg font-medium ring-1 ring-line" : "text-fg-subtle hover:text-fg"
            )}
          >
            {o.label}
            <span className={cn("font-mono text-[10.5px] tabular-nums", active ? "text-fg-subtle" : "text-fg-faint")}>{counts[o.value]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
