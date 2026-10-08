"use client";

import { cn } from "@/lib/utils";

/** On/off switch: white track when on, raised grey when off. */
export function Switch({ on, label, pending, onToggle }: { on: boolean; label: string; pending: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full border transition-colors disabled:opacity-50",
        on ? "border-fg bg-fg" : "border-line-strong bg-surface-raised"
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] size-3 rounded-full transition-transform duration-100",
          on ? "translate-x-[14px] bg-canvas" : "bg-fg-subtle"
        )}
      />
    </button>
  );
}
