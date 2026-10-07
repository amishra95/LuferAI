"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, Plus, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Team dinner for 45 on 14 November in Indiranagar, about ₹2,000 a head, all vegetarian, private room with a screen",
  "Client cocktail evening for 30 in UB City next month, ₹4,000 a head, halal options",
  "Sales kickoff lunch for 80 in Koramangala, under ₹1,800 a head, Jain and vegan covered",
];

/** Refinements toggle a phrase in or out of the brief. */
const REFINEMENTS = ["Private dining room", "All vegetarian", "Jain options", "Halal options", "AV & screen", "Live music"];

const hasPhrase = (brief: string, phrase: string) => brief.toLowerCase().includes(phrase.toLowerCase());

/**
 * Natural-language RFP prompt. Sends the brief to /api/ai/rfp-broadcast; matching
 * venues get a structured RFP and the comparison matrix appears below on refresh.
 */
export function RfpBroadcastForm() {
  const router = useRouter();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [brief, setBrief] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const toggle = (phrase: string) => {
    setBrief((b) =>
      hasPhrase(b, phrase)
        ? b.replace(new RegExp(`[,.]?\\s*${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "").trim()
        : `${b.trim()}${b.trim() ? ", " : ""}${phrase.toLowerCase()}`
    );
    textarea.current?.focus();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (brief.trim().length < 20 || pending) return;
    setPending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/ai/rfp-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const json = await res.json();
      if (res.status === 429) throw new Error(`Too many requests — try again in ${json.retryAfter ?? 60}s.`);
      if (!res.ok) throw new Error(json.error ?? "Broadcast failed");
      setStatus({ ok: true, message: `Sent to ${json.venuesContacted} venue${json.venuesContacted === 1 ? "" : "s"} — quotes are in the comparison below.` });
      setBrief("");
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : "Broadcast failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="glass group relative rounded-2xl p-2 shadow-[0_0_40px_-12px] shadow-emerald-400/25 transition-shadow focus-within:shadow-emerald-400/45">
        <label htmlFor="brief" className="sr-only">
          Describe your event
        </label>
        <div className="flex items-start gap-2">
          <Sparkles className="mt-3 ml-2 size-5 shrink-0 text-emerald-700" aria-hidden />
          <textarea
            ref={textarea}
            id="brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Describe the event — guests, date, area, budget, dietary needs…"
            rows={2}
            maxLength={4000}
            className="field-sizing-content max-h-48 min-h-12 flex-1 resize-none bg-transparent py-2.5 text-base text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || brief.trim().length < 20}
            aria-label="Broadcast RFP to matching venues"
            className="mt-1 grid size-11 shrink-0 place-items-center rounded-xl bg-fg text-white transition hover:bg-white disabled:bg-surface-raised disabled:text-fg-faint"
          >
            {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ArrowUp className="size-5" aria-hidden />}
          </button>
        </div>

        <div className="mt-1 flex flex-wrap gap-1.5 px-2 pb-1" role="group" aria-label="Refine the brief">
          {REFINEMENTS.map((r) => {
            const on = hasPhrase(brief, r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r)}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-xs transition pointer-coarse:min-h-11",
                  on
                    ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-700 shadow-[0_0_12px_-4px] shadow-emerald-400/60"
                    : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                {on ? <X className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {!brief ? (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Example briefs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setBrief(ex);
                textarea.current?.focus();
              }}
              className="min-h-11 max-w-72 shrink-0 rounded-xl border border-line/60 bg-surface px-3 py-2 text-left text-xs text-fg-subtle transition hover:border-line-strong hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {pending ? (
        <p role="status" className="text-sm text-fg-subtle">
          Reading your brief and pricing matching venues…
        </p>
      ) : status ? (
        <p role="status" className={status.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
