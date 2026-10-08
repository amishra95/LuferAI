import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Zero-data state: a dashed hairline frame, a small icon tile, a Fraunces
 * title and a Geist Mono explanation, with an optional action (a link or
 * button styled with `btn`). Inside the concierge scope the frame picks up a
 * faint amber inner glow and the icon warms on hover; on light pages it stays
 * quiet zinc.
 *
 * Say why it's empty and what to do next, not just "No data".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel = 3,
  compact = false,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  /** Match the surrounding outline: 2 for a page section, 3 inside a card. */
  headingLevel?: 2 | 3;
  /** Less padding, for use inside an existing card. */
  compact?: boolean;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      className={cn(
        "group border-line-strong animate-in fade-in relative flex flex-col items-center rounded-2xl border border-dashed text-center duration-500",
        "concierge:border-white/15 concierge:bg-white/[0.015] concierge:shadow-[inset_0_0_48px_-24px_rgb(245_158_11/0.35)]",
        compact ? "px-6 py-10" : "px-6 py-14",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "border-line bg-surface text-fg-subtle mb-5 grid size-11 place-items-center rounded-xl border transition-[color,border-color,box-shadow] duration-300",
          "concierge:group-hover:border-amber-400/30 concierge:group-hover:text-amber-300 concierge:group-hover:shadow-[0_0_24px_-6px_rgb(245_158_11/0.5)] concierge:shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
        )}
      >
        <Icon className="size-5" strokeWidth={1.5} />
      </span>
      <Heading className="display-heading text-[21px] leading-tight text-balance">{title}</Heading>
      <p className="text-fg-subtle mt-2.5 max-w-md font-mono text-[12px] leading-relaxed tracking-wide text-pretty">{description}</p>
      {/* Actions are often plain `btn` links; give them 44px touch targets like Button. */}
      {action ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2 pointer-coarse:[&_.btn]:min-h-11 pointer-coarse:[&_.btn]:px-4">{action}</div> : null}
    </div>
  );
}
