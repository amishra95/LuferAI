"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertTriangle, BarChart3, MapPin, Sparkles, Users } from "lucide-react";

import { ChatMessage, ThinkingDots } from "@/components/chat/chat-message";
import { Inspector, type SessionInfo } from "@/components/chat/inspector";
import { PromptBar } from "@/components/chat/prompt-bar";
import { isLuferToolPart, type LuferToolPart } from "@/components/chat/tool-meta";
import { cn } from "@/lib/utils";
import type { LuferUIMessage } from "@/types/chat";

const SUGGESTIONS = [
  { icon: Users, text: "Find a venue for 40 people with a private dining room" },
  { icon: MapPin, text: "What can host 120 guests in Whitefield under ₹3,000 a head?" },
  { icon: BarChart3, text: "Summarise platform bookings and commission so far" },
];

const DESKTOP = "(min-width: 1024px)";

/** Route errors arrive as the raw response body, e.g. {"error":"..."}; show just the message. */
function errorText(error: Error): string {
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON: already a readable message.
  }
  return error.message || "Something went wrong.";
}

export function ChatWorkspace({
  model,
  demo,
  defaultInspectorOpen,
}: {
  model: string;
  demo: boolean;
  defaultInspectorOpen: boolean;
}) {
  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } = useChat<LuferUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(defaultInspectorOpen); // desktop side panel
  const [mobileInspector, setMobileInspector] = useState(false); // below lg: overlay

  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);

  const toolCalls = useMemo<LuferToolPart[]>(
    () => messages.flatMap((m) => (m.role === "assistant" ? m.parts.filter(isLuferToolPart) : [])),
    [messages]
  );

  const session: SessionInfo = {
    model: messages.findLast((m) => m.metadata?.model)?.metadata?.model ?? model,
    demo,
    status,
    messageCount: messages.length,
    totalTokens: messages.reduce((n, m) => n + (m.metadata?.usage?.totalTokens ?? 0), 0),
  };

  // Follow the stream, unless the reader has scrolled up to look at something.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  function selectTool(id: string | null) {
    setSelectedToolCallId(id);
    if (id && window.matchMedia(DESKTOP).matches) setInspectorOpen(true);
    else if (id) setMobileInspector(true);
  }

  function toggleInspector() {
    if (window.matchMedia(DESKTOP).matches) setInspectorOpen((o) => !o);
    else setMobileInspector((o) => !o);
  }

  function send(text: string) {
    pinned.current = true;
    clearError();
    void sendMessage({ text });
  }

  const inspector = (onClose: () => void) => (
    <Inspector
      session={session}
      toolCalls={toolCalls}
      selectedToolCallId={selectedToolCallId}
      onSelectTool={setSelectedToolCallId}
      onClose={onClose}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 bg-zinc-950/40">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
            {demo && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Demo mode: OPENAI_API_KEY isn&apos;t set, so replies are scripted. Tool calls still run against real app data.
              </p>
            )}

            {messages.length === 0 ? (
              <div className="pt-10 text-center">
                <div className="mx-auto grid size-10 place-items-center rounded-lg border border-zinc-800 bg-zinc-900">
                  <Sparkles className="size-5 text-zinc-300" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-zinc-50">Agent workspace</h1>
                <p className="mt-1 text-sm text-zinc-400">Ask a question. Tool calls show up inline and in the inspector.</p>
                <div className="mx-auto mt-6 grid max-w-xl gap-2 text-left">
                  {SUGGESTIONS.map(({ icon: Icon, text }) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => send(text)}
                      className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
                    >
                      <Icon className="size-4 shrink-0 text-zinc-500" aria-hidden />
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div aria-live="polite" aria-busy={busy} className="space-y-6">
                {messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    streaming={status === "streaming" && m === last && m.role === "assistant"}
                    selectedToolCallId={selectedToolCallId}
                    onSelectTool={selectTool}
                  />
                ))}
                {status === "submitted" && (
                  <div className="pl-10">
                    <ThinkingDots />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-center gap-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{errorText(error)}</span>
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  className="rounded px-2 py-0.5 text-xs text-red-200 hover:bg-red-500/20"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        <PromptBar
          busy={busy}
          onSend={send}
          onStop={() => void stop()}
          onNewChat={() => {
            void stop();
            setMessages([]);
            setSelectedToolCallId(null);
            clearError();
          }}
          onToggleInspector={toggleInspector}
          inspectorOpen={inspectorOpen}
          canReset={messages.length > 0}
        />
      </div>

      <div className={cn("hidden w-80 shrink-0 border-l border-zinc-800", inspectorOpen && "lg:block")}>
        {inspector(() => setInspectorOpen(false))}
      </div>

      {mobileInspector && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Inspector">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileInspector(false)} aria-hidden />
          <div className="absolute inset-y-0 right-0 w-[min(20rem,90vw)] border-l border-zinc-800">
            {inspector(() => setMobileInspector(false))}
          </div>
        </div>
      )}
    </div>
  );
}
