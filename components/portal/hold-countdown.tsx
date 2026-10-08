"use client";

import { useSyncExternalStore } from "react";
import { Timer } from "lucide-react";

import { formatHoldCountdown } from "@/lib/inventory/plan-hold";
import { cn } from "@/lib/utils";

// One shared 30s clock for every countdown on the page.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const useNow = () =>
  useSyncExternalStore(
    subscribe,
    () => now,
    () => null // server: render a placeholder, so server/client clocks can't mismatch
  );


/**
 * Time left in a venue's response window: a meter that drains from full, turning
 * amber under 12 hours and red under 2. Text carries the value, not colour alone.
 */
export function HoldCountdown({ createdAt, expiresAt, className }: { createdAt: string; expiresAt: string; className?: string }) {
  const t = useNow();
  const start = Date.parse(createdAt);
  const end = Date.parse(expiresAt);
  const total = Math.max(end - start, 1);
  const left = t == null ? null : end - t;
  const pct = left == null ? 100 : Math.min(100, Math.max(0, (left / total) * 100));
  const tone = left == null || left > 12 * 3_600_000 ? "sky" : left > 2 * 3_600_000 ? "amber" : "red";

  return (
    <div className={cn("grid min-w-36 gap-1", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            tone === "sky" && "text-sky-700 dark:text-sky-300",
            tone === "amber" && "text-amber-800 dark:text-amber-300",
            tone === "red" && "text-red-700 dark:text-red-300"
          )}
        >
          <Timer className="size-3.5" aria-hidden />
          Hold
        </span>
        <span className="text-fg-muted tabular-nums">{t == null ? "—" : formatHoldCountdown(expiresAt, t)}</span>
      </div>
      <div
        role="meter"
        aria-label="Venue response window remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={t == null ? undefined : formatHoldCountdown(expiresAt, t)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700",
            tone === "sky" && "bg-sky-400 shadow-[0_0_8px] shadow-sky-400/70",
            tone === "amber" && "bg-amber-400 shadow-[0_0_8px] shadow-amber-400/70",
            tone === "red" && "bg-red-400 shadow-[0_0_8px] shadow-red-400/70"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
