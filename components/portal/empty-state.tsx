import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Zero-data state: a dashed 1px frame, a small icon, a title and an optional
 * next step (a `btn` link or button). The title says what's missing ("No
 * bookings yet"); the action says what to do. `description` is for a fact the
 * viewer needs (a filter that hid everything, a missing setup), never prose.
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
  description?: React.ReactNode;
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
      <span className="bg-surface-raised text-link mb-3 grid size-10 place-items-center rounded-full" aria-hidden>
        <Icon className="size-5" strokeWidth={1.5} />
      </span>
      <Heading className="text-fg text-card-title font-semibold">{title}</Heading>
      {description ? <p className="text-fg-subtle mt-1 max-w-md text-meta leading-5 text-pretty">{description}</p> : null}
      {/* Actions are often plain `btn` links; give them 44px touch targets like Button. */}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2 pointer-coarse:[&_.btn]:min-h-11 pointer-coarse:[&_.btn]:px-4">{action}</div> : null}
    </div>
  );
}
