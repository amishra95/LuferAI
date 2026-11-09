import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * First-run setup on Home, for Approvers: office area, an approver on the
 * chain, per-head limits. Without them venue cards can't show distance or
 * "In policy", and sign-offs have nobody to go to. Hidden once all are done.
 */
export function SetupChecklist({ items }: { items: readonly { key: string; label: string; done: boolean }[] }) {
  if (items.every((i) => i.done)) return null;
  const left = items.filter((i) => !i.done).length;
  return (
    <section aria-labelledby="setup-heading" className="panel mb-10 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="setup-heading" className="text-fg text-body font-semibold">
          Set up your company
        </h2>
        <span className="text-fg-subtle font-mono text-caption tabular-nums">
          {items.length - left}/{items.length}
        </span>
      </div>
      <ul className="grid gap-1">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              href={i.key === "approvers" ? "/governance" : "/governance#setup"}
              className={cn("hover:bg-surface-hover -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-meta", i.done ? "text-fg-subtle" : "text-fg")}
            >
              <span
                aria-hidden
                className={cn("grid size-5 shrink-0 place-items-center rounded-full border", i.done ? "bg-sage border-sage text-on-ink" : "border-line-strong")}
              >
                {i.done ? <Check className="size-3" /> : null}
              </span>
              <span className={cn("flex-1", i.done && "line-through")}>{i.label}</span>
              <span className="sr-only">{i.done ? "(done)" : "(to do)"}</span>
              {i.done ? null : <ArrowRight className="text-fg-subtle size-3.5" aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
