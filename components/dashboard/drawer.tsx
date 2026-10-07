"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** Mobile slide-over. Closes on Escape and backdrop click; focuses itself on open. */
export function Drawer({
  open,
  onClose,
  side,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the open effect when callers pass inline arrows.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={cn("fixed inset-0 z-50", className)} role="dialog" aria-modal="true" aria-label={label}>
      <div className="animate-in fade-in absolute inset-0 bg-zinc-950/20 backdrop-blur-[2px] duration-200" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        tabIndex={-1}
        className={cn(
          "bg-elevated/95 absolute inset-y-0 flex w-[min(18rem,86vw)] flex-col shadow-2xl shadow-zinc-900/15 outline-none backdrop-blur-xl duration-200",
          side === "left" ? "animate-in slide-in-from-left left-0 border-r border-line" : "animate-in slide-in-from-right right-0 border-l border-line"
        )}
      >
        {children}
      </div>
    </div>
  );
}
