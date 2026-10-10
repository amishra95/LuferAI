"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertTriangle, ArrowUpRight, MapPin, PieChart, RotateCw, TrendingUp, Users } from "lucide-react";

import { AgentMark, ChatMessage, ThinkingDots } from "@/components/chat/chat-message";
import { Inspector, type SessionInfo } from "@/components/chat/inspector";
import { PromptBar } from "@/components/chat/prompt-bar";
import { isLuferToolPart, type LuferToolPart } from "@/components/chat/tool-meta";
import { Drawer } from "@/components/dashboard/drawer";
import { cn } from "@/lib/utils";
import type { LuferUIMessage } from "@/types/chat";

const SUGGESTIONS = [
  { icon: Users, text: "Find a venue for 40 people with a private dining room" },
  { icon: MapPin, text: "What can host 120 guests in Whitefield under ₹3,000 a head?" },
  { icon: PieChart, text: "How much have we spent this financial year, by month?" },
  { icon: TrendingUp, text: "Will we stay within budget this year?" },
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
  offline: noModel,
  agentEnabled,
  defaultInspectorOpen,
}: {
  model: string;
  /** No model configured: chat is unavailable. */
  offline: boolean;
  /** The workspace agent is switched off on the Agents page. */
  agentEnabled: boolean;
  defaultInspectorOpen: boolean;
}) {
  // Either way the chat route would refuse, so don't offer to send.
  const offline = noModel || !agentEnabled;
  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } = useChat<LuferUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(defaultInspectorOpen); // desktop side panel
  const [mobileInspector, setMobileInspector] = useState(false); // below lg: drawer

  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);

  const toolCalls = useMemo<LuferToolPart[]>(
    () => messages.flatMap((m) => (m.role === "assistant" ? m.parts.filter(isLuferToolPart) : [])),
    [messages]
  );

  const session: SessionInfo = {
    model: messages.findLast((m) => m.metadata?.model)?.metadata?.model ?? model,
    offline,
    status,
    messageCount: messages.length,
    totalTokens: messages.reduce((n, m) => n + (m.metadata?.usage?.totalTokens ?? 0), 0),
    traceId: messages.findLast((m) => m.metadata?.traceId)?.metadata?.traceId ?? null,
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
    if (offline) return;
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
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 overflow-y-auto"
        >
          {/* Bottom padding clears the floating composer. */}
          <div className="mx-auto max-w-[46rem] px-4 pt-8 pb-48 sm:px-6">
            {!noModel && !agentEnabled && (
              <div role="status" className="text-fg-subtle mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="pill">
                  <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden />
                  agent off
                </span>
                The workspace agent is disabled.
                <Link href="/agents" className="text-fg-muted hover:text-fg inline-flex items-center gap-0.5 transition-colors">
                  Enable it <ArrowUpRight className="size-3" aria-hidden />
                </Link>
              </div>
            )}
            {noModel && (
              <div role="status" className="text-fg-subtle mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="pill">
                  <span className="border-fg-faint size-1.5 rounded-full border" aria-hidden />
                  no model
                </span>
                Chat is unavailable until an OpenAI key is configured.
                <Link href="/settings" className="text-fg-muted hover:text-fg inline-flex items-center gap-0.5 transition-colors">
                  Connect a key <ArrowUpRight className="size-3" aria-hidden />
                </Link>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="pt-[8vh]">
                <AgentMark />
                <h1 className="text-fg mt-5 text-[24px] font-semibold tracking-[-0.03em]">What should we look into?</h1>
                <p className="text-fg-subtle mt-1.5 text-[14px]">
                  The agent searches venues and analyses spend and budgets from your booking data. Every tool call is inspectable.
                </p>
                <ul className="panel mt-8 overflow-hidden">
                  {SUGGESTIONS.map(({ icon: Icon, text }) => (
                    <li key={text} className="border-line border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => send(text)}
                        disabled={offline}
                        className="disabled:pointer-events-none disabled:opacity-60 group text-fg-muted hover:bg-surface-hover hover:text-fg flex w-full items-center gap-3.5 px-4 py-3.5 text-left text-[13.5px] transition-colors"
                      >
                        <Icon className="text-fg-faint group-hover:text-fg size-4 shrink-0 transition-colors" strokeWidth={1.75} aria-hidden />
                        <span className="flex-1">{text}</span>
                        <ArrowUpRight className="text-fg-faint size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div aria-live="polite" aria-busy={busy} className="space-y-8">
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
                  <div className="flex gap-3.5">
                    <AgentMark live />
                    <ThinkingDots />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div role="alert" className="border-rose/20 bg-rose/[0.05] text-rose mt-8 flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{errorText(error)}</span>
                <button type="button" onClick={() => void regenerate()} className="btn btn-ghost text-rose hover:text-rose h-7 px-2 text-[12px]">
                  <RotateCw className="size-3" aria-hidden /> Retry
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-canvas border-line pointer-events-none absolute inset-x-0 bottom-0 border-t px-4 pt-3 pb-4 sm:px-6 sm:pb-5">
          <div className="pointer-events-auto mx-auto max-w-[46rem]">
            <PromptBar
              busy={busy}
              disabled={offline}
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
        </div>
      </div>

      <div className={cn("border-line bg-surface hidden w-[21rem] shrink-0 border-l", inspectorOpen && "lg:block")}>
        {inspector(() => setInspectorOpen(false))}
      </div>

      <Drawer open={mobileInspector} onClose={() => setMobileInspector(false)} side="right" label="Inspector" className="lg:hidden">
        {inspector(() => setMobileInspector(false))}
      </Drawer>
    </div>
  );
}
