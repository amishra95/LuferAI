import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Zero-data state: a dashed 1px frame, a small icon, a title, one or two
 * sentences on why it's empty, and an optional next step (a `btn` link or
 * button). Say why it's empty and what to do, not just "No data".
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
    <div className={cn("border-line-strong flex flex-col items-center rounded-lg border border-dashed px-6 text-center", compact ? "py-8" : "py-12", className)}>
      <Icon className="text-fg-faint mb-3 size-5" strokeWidth={1.5} aria-hidden />
      <Heading className="text-fg text-[13.5px] font-medium">{title}</Heading>
      <p className="text-fg-subtle mt-1 max-w-md text-[12.5px] leading-5 text-pretty">{description}</p>
      {/* Actions are often plain `btn` links; give them 44px touch targets like Button. */}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2 pointer-coarse:[&_.btn]:min-h-11 pointer-coarse:[&_.btn]:px-4">{action}</div> : null}
    </div>
  );
}
