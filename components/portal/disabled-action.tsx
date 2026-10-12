"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * An action the viewer can see but not take: a disabled `btn` with the reason
 * as a hover tooltip and as its accessible description. The tooltip sits on a
 * wrapper because disabled buttons don't receive pointer events in every
 * browser.
 */
export function DisabledAction({ reason, children, className }: { reason: string; children: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <span title={reason} className="inline-flex cursor-not-allowed">
      <button type="button" disabled aria-describedby={id} className={cn("btn pointer-events-none", className)}>
        {children}
      </button>
      <span id={id} className="sr-only">
        {reason}
      </span>
    </span>
  );
}
