"use client";

import { cn } from "@/lib/utils";

/** Copper on/off switch (copper = active state). */
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
        on ? "border-copper-deep bg-copper" : "border-line-strong bg-zinc-200"
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] left-[2px] size-3 rounded-full transition-all duration-200",
          on ? "translate-x-[14px] bg-white shadow-[0_1px_2px_rgb(9_9_11/0.25)]" : "bg-white shadow-[0_1px_2px_rgb(9_9_11/0.2)]"
        )}
      />
    </button>
  );
}
