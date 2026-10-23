"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Turn = { role: "visitor" | "agent"; text: string };
type Alternative = { id: string; name: string; neighborhood: string; capacity_max: number; from_per_head_inr: number | null; link: string };

const key = (venueId: string) => `lufer:inquiry:${venueId}`;
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

type Saved = { token: string | null; turns: Turn[] };

/** The saved conversation's raw JSON: null on the server and when storage is off. */
function readRaw(venueId: string): string | null {
  try {
    return window.localStorage.getItem(key(venueId));
  } catch {
    return null;
  }
}
function parse(raw: string | null): Saved {
  try {
    const v = raw ? (JSON.parse(raw) as { token?: unknown; turns?: unknown }) : null;
    return { token: typeof v?.token === "string" ? v.token : null, turns: Array.isArray(v?.turns) ? (v.turns as Turn[]).slice(-40) : [] };
  } catch {
    return { token: null, turns: [] };
  }
}
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
function save(venueId: string, token: string, turns: Turn[]) {
  try {
    window.localStorage.setItem(key(venueId), JSON.stringify({ token, turns: turns.slice(-40) }));
  } catch {
    // Private mode or storage off: the conversation still works for this visit.
  }
}

/** The visitor's side of the inquiry agent (POST /api/inquiries). */
export function InquiryChat({ venueId, venueName }: { venueId: string; venueName: string }) {
  // Saved per browser so a reload continues the same conversation; this visit's turns override it.
  const raw = useSyncExternalStore(subscribe, () => readRaw(venueId), () => null);
  const saved = useMemo(() => parse(raw), [raw]);
  const [live, setLive] = useState<Saved | null>(null);
  const { token, turns } = live ?? saved;
  const setTurns = (t: Turn[]) => setLive({ token, turns: t });
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [turns, pending]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    setError(null);
    setText("");
    const next: Turn[] = [...turns, { role: "visitor", text: message }];
    setTurns(next);
    try {
      const res = await fetch("/api/inquiries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venueId, token, message }) });
      const body = (await res.json().catch(() => null)) as { token?: string; reply?: string; alternatives?: Alternative[]; error?: string } | null;
      if (!res.ok || !body?.token || !body.reply) throw new Error(body?.error ?? (res.status === 429 ? "Too many messages. Wait a moment and try again." : "Something went wrong. Please try again."));
      const withReply: Turn[] = [...next, { role: "agent", text: body.reply }];
      setLive({ token: body.token, turns: withReply });
      setAlternatives(body.alternatives ?? []);
      save(venueId, body.token, withReply);
    } catch (err) {
      setTurns(turns);
      setText(message);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label={`Chat with ${venueName}`} className="panel flex min-h-[24rem] flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {turns.length === 0 ? (
          <p className="text-fg-subtle text-body">
            Hi! Tell us about your event: the date, how many guests, and your budget per head. We can check availability and get you a quote.
          </p>
        ) : null}
        {turns.map((t, i) => (
          <p
            key={i}
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-body whitespace-pre-line break-words",
              t.role === "visitor" ? "bg-surface-raised text-fg ml-auto" : "border-line text-fg border"
            )}
          >
            <span className="sr-only">{t.role === "visitor" ? "You: " : `${venueName}: `}</span>
            {t.text}
          </p>
        ))}
        {pending ? (
          <p className="text-fg-subtle inline-flex items-center gap-2 text-meta">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking…
          </p>
        ) : null}
        {alternatives.length ? (
          <div className="grid gap-2">
            <p className="text-fg-subtle text-caption font-medium">Available nearby</p>
            {alternatives.map((a) => (
              <a key={a.id} href={a.link} className="panel-interactive flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  <span className="text-fg block text-body font-medium">{a.name}</span>
                  <span className="text-fg-subtle inline-flex items-center gap-1 text-caption">
                    <MapPin className="size-3" aria-hidden /> {a.neighborhood} · up to {a.capacity_max}
                  </span>
                </span>
                {a.from_per_head_inr ? <span className="text-fg-muted text-meta tabular-nums">from {INR.format(a.from_per_head_inr)}</span> : null}
              </a>
            ))}
          </div>
        ) : null}
        <div ref={end} />
      </div>
      {error ? (
        <p role="alert" className="text-rose px-4 pb-2 text-meta">
          {error}
        </p>
      ) : null}
      <form onSubmit={send} className="border-line flex items-end gap-2 border-t p-3">
        <label htmlFor="inquiry-message" className="sr-only">
          Your message
        </label>
        <textarea
          id="inquiry-message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Team dinner for 40 on 20 Nov, around ₹2,500 a head…"
          className="field max-h-32 min-h-11 flex-1 resize-none py-2"
        />
        <Button type="submit" disabled={pending || !text.trim()} className="min-h-11" aria-label="Send">
          <ArrowUp className="size-4" aria-hidden />
        </Button>
      </form>
    </section>
  );
}
