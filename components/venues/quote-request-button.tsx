"use client";

import { useState, useTransition } from "react";
import { Dialog } from "radix-ui";
import { CheckCircle2, Loader2, MessageSquarePlus, X } from "lucide-react";

import { requestQuoteAction } from "@/app/(dashboard)/venues/actions";
import { cn } from "@/lib/utils";

const blank = { date: "", guests: "", perHead: "", notes: "" };

/**
 * "Request a quote" for a partner listing: date, guests, budget, notes. Lufer
 * arranges it with the venue and replies by email (lib/concierge/request.ts).
 */
export function QuoteRequestButton({ venue, className }: { venue: { id: string; name: string }; className?: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(blank);
  const [state, setState] = useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();
  const field = (k: keyof typeof blank) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value })) });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const result = await requestQuoteAction({ venueId: venue.id, ...v });
      setState(result);
      if (result.ok) setV(blank);
    });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setState(null);
      }}
    >
      <Dialog.Trigger className={cn("btn h-8 gap-1.5 px-3 text-caption", className)}>
        <MessageSquarePlus className="size-3.5" aria-hidden /> Request a quote
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          className={cn(
            "lufer bg-canvas border-line fixed z-50 flex flex-col border shadow-2xl outline-none",
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-[var(--app-safe-bottom)]",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0"
          )}
        >
          <header className="border-line flex items-start gap-3 border-b px-5 py-4">
            <Dialog.Title className="text-fg min-w-0 flex-1 text-section font-semibold tracking-tight">{venue.name}</Dialog.Title>
            <Dialog.Description className="sr-only">Request a quote from {venue.name}</Dialog.Description>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-1.5 size-8" aria-label="Close">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </header>

          {state?.ok ? (
            <div role="status" className="grid justify-items-start gap-3 px-5 py-6">
              <p className="text-fg flex items-start gap-2 text-body">
                <CheckCircle2 className="text-sage mt-0.5 size-4 shrink-0" aria-hidden />
                Sent. We&apos;ll email you options and prices, usually within a working day.
              </p>
              <Dialog.Close className="btn h-9">Done</Dialog.Close>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4 overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5">
                  <span className="text-fg text-meta font-medium">Date</span>
                  <input type="date" required min={today} className="field" {...field("date")} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-fg text-meta font-medium">Guests</span>
                  <input type="number" required min={2} inputMode="numeric" className="field font-mono" {...field("guests")} />
                </label>
              </div>
              <label className="grid gap-1.5">
                <span className="text-fg text-meta font-medium">Budget per head (₹, pre-GST)</span>
                <input type="number" min={100} step={50} inputMode="numeric" className="field font-mono" placeholder="Optional" {...field("perHead")} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-fg text-meta font-medium">Notes</span>
                <textarea rows={3} maxLength={1000} className="field h-auto py-2" placeholder="Private room, dietary needs, timing…" {...field("notes")} />
              </label>
              {state && !state.ok ? (
                <p role="alert" className="text-destructive text-meta">
                  {state.error}
                </p>
              ) : null}
              <button type="submit" className="btn btn-primary h-10" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Send request
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
