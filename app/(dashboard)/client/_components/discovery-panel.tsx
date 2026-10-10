"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertTriangle, ArrowUp, ArrowUpRight, RotateCw, Sparkles, Square } from "lucide-react";

import { AgentMark, ChatMessage, ThinkingDots } from "@/components/chat/chat-message";
import { cn } from "@/lib/utils";
import type { LuferUIMessage } from "@/types/chat";

const PROMPTS = [
  "Team dinner for 40 in Indiranagar, ₹2,500 a head, private room",
  "Offsite for 120 in Whitefield next month under ₹3,000 a head",
  "How much of our budget is left this quarter?",
];

/**
 * Conversational discovery on the buyer portal: the same workspace agent as
 * /chat (/api/chat, scoped to the user's company), in a compact panel next to
 * the booking tools. It searches venues and answers spend questions; booking
 * still happens in the venue explorer below, so nothing is committed from chat.
 * The full conversation, with the tool inspector, is one click away on /chat.
 */
export function DiscoveryPanel({ offline, reason }: { offline: boolean; reason?: string }) {
  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } = useChat<LuferUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [draft, setDraft] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the answer as it streams.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy || offline) return;
    void sendMessage({ text: t });
    setDraft("");
  };

  return (
    <section aria-label="Ask the concierge" className="panel overflow-hidden">
      <header className="border-line flex items-center gap-3 border-b px-5 py-3">
        <Sparkles className="text-fg-subtle size-4" aria-hidden />
        <h2 className="text-fg text-[13.5px] font-medium">Ask the concierge</h2>
        <span className="text-fg-subtle hidden text-[12.5px] sm:inline">Describe the event; it searches venues and checks your budget.</span>
        <div className="ml-auto flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                void stop();
                setMessages([]);
                clearError();
              }}
              className="btn btn-ghost h-7 px-2 text-[12px]"
            >
              New
            </button>
          )}
          <Link href="/chat" className="btn btn-ghost h-7 px-2 text-[12px]">
            Full chat <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </div>
      </header>

      {messages.length === 0 ? (
        <div className="px-5 py-4">
          {offline ? (
            <p role="status" className="text-fg-subtle text-[12.5px]">
              {reason ?? "The concierge is unavailable right now."}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Try asking">
              {PROMPTS.map((p) => (
                <li key={p}>
                  <button type="button" onClick={() => send(p)} className="border-line text-fg-muted hover:border-line-strong hover:text-fg rounded-full border px-3 py-1.5 text-left text-[12.5px] transition-colors">
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div ref={scroller} aria-live="polite" aria-busy={busy} className="max-h-[28rem] space-y-6 overflow-y-auto px-5 py-5">
          {messages.map((m) => (
            // Tool details live in /chat's inspector; here the summary is enough.
            <ChatMessage key={m.id} message={m} streaming={status === "streaming" && m === last && m.role === "assistant"} selectedToolCallId={null} onSelectTool={() => {}} />
          ))}
          {status === "submitted" && (
            <div className="flex gap-3.5">
              <AgentMark live />
              <ThinkingDots />
            </div>
          )}
          {error && (
            <div role="alert" className="border-rose/20 bg-rose/[0.05] text-rose flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{error.message || "Something went wrong."}</span>
              <button type="button" onClick={() => void regenerate()} className="btn btn-ghost text-rose hover:text-rose h-7 px-2 text-[12px]">
                <RotateCw className="size-3" aria-hidden /> Retry
              </button>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="border-line flex items-end gap-2 border-t px-3 py-2.5"
      >
        <label htmlFor="discovery-input" className="sr-only">
          Describe your event
        </label>
        <textarea
          id="discovery-input"
          rows={1}
          value={draft}
          disabled={offline}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder={offline ? "Unavailable" : "Who, where, when, and the budget per head…"}
          className="field-sizing-content text-fg placeholder:text-fg-faint max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] focus-visible:outline-none disabled:cursor-not-allowed"
        />
        {busy ? (
          <button type="button" onClick={() => void stop()} className="btn btn-icon size-9" aria-label="Stop">
            <Square className="size-3.5" aria-hidden />
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim() || offline} className={cn("btn btn-primary btn-icon size-9", !draft.trim() && "opacity-50")} aria-label="Send">
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </form>
    </section>
  );
}
