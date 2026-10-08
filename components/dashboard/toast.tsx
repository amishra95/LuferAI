"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Check, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";
export type ToastInput = { tone: ToastTone; title: string; description?: string };
type Toast = ToastInput & { id: number };

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

/** Show a toast from any client component under the dashboard shell. */
export const useToast = () => useContext(ToastContext);

const ICON = {
  success: <Check className="text-sage size-3.5" strokeWidth={2.5} aria-hidden />,
  error: <X className="text-rose size-3.5" strokeWidth={2.5} aria-hidden />,
  info: <Info className="text-fg-muted size-3.5" aria-hidden />,
};

let nextId = 1;
const MAX_VISIBLE = 4;

/**
 * Minimal toast stack: bottom-right on desktop, bottom on phones. Errors stay
 * longer and are announced assertively; others politely.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId++;
      setToasts((ts) => [...ts.slice(-(MAX_VISIBLE - 1)), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 9000 : 4500);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "animate-in fade-in slide-in-from-bottom-2 border-line bg-elevated pointer-events-auto flex w-full items-start gap-3 rounded-lg border px-4 py-3 duration-200 sm:w-[22rem]",
              t.tone === "error" && "border-rose/25"
            )}
          >
            <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", t.tone === "success" ? "bg-sage/10" : t.tone === "error" ? "bg-rose/10" : "bg-surface-raised")}>
              {ICON[t.tone]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-fg text-[13px] leading-5 font-medium">{t.title}</p>
              {t.description && <p className="text-fg-subtle mt-0.5 text-[12.5px] leading-5 break-words">{t.description}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="btn btn-ghost btn-icon -mr-1.5 size-6 shrink-0">
              <X className="size-3" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
