"use client";

import { useEffect, useRef, useState } from "react";
import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type ChatAddToolApproveResponseFunction } from "ai";
import { Check, Loader2, Send, Sparkles, Square, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NegotiatorUIMessage } from "@/lib/negotiator";
import { dietaryLabel } from "@/lib/quotes";
import { formatINR } from "@/lib/utils";

const SUGGESTIONS = [
  "Should I lower my minimum spend to win more of the open RFPs?",
  "Add a Jain-friendly vegetarian package around ₹1,800 a head",
  "Which dietary needs are clients asking for that my packages don't cover?",
];

type Part = NegotiatorUIMessage["parts"][number];
type ApprovalPart = Extract<Part, { type: "tool-setMinimumSpend" | "tool-upsertMenuPackage" }>;

/**
 * Streaming AI panel for hosts to tune minimum spend and menu packages. The model
 * proposes each change as a tool call; nothing is written until the host approves.
 */
/** Chat state for the negotiator, owned by the drawer so it survives closing it. */
export function createNegotiatorChat(venueId: string, onFinish: () => void) {
  return new Chat<NegotiatorUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/ai/property-negotiator", body: { venueId } }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish,
  });
}

export function NegotiatorPanel({ chat }: { chat: Chat<NegotiatorUIMessage> }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, addToolApprovalResponse, status, stop, error } = useChat({ chat });
  const busy = status === "submitted" || status === "streaming";
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the latest message in view as it streams.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="grid gap-3">
            <p className="text-sm text-fg-subtle">
              I can read your terms and open RFPs, then propose minimum-spend and menu changes. Nothing changes until you
              tap Apply.
            </p>
            <div className="grid gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="min-h-11 rounded-lg border border-line/60 bg-surface px-3 py-2 text-left text-sm text-fg-muted transition hover:border-line-strong hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-10 self-end rounded-lg rounded-br-md bg-surface-raised px-3.5 py-2 text-sm text-fg">
              {m.parts.map((part, i) => (part.type === "text" ? <span key={i}>{part.text}</span> : null))}
            </div>
          ) : (
            <div key={m.id} className="mr-6 grid gap-2 text-sm text-fg">
              {m.parts.map((part, i) => {
                switch (part.type) {
                  case "text":
                    return (
                      <p key={i} className="leading-relaxed whitespace-pre-wrap">
                        {part.text}
                      </p>
                    );
                  case "tool-getVenueTerms":
                    return (
                      <p key={i} className="flex items-center gap-1.5 text-xs text-fg-faint">
                        <Sparkles className="size-3 text-sage" aria-hidden />
                        {part.state === "output-available" ? "Checked your current terms and open RFPs" : "Checking your terms…"}
                      </p>
                    );
                  case "tool-setMinimumSpend":
                  case "tool-upsertMenuPackage":
                    return <ProposedChange key={i} part={part} onRespond={addToolApprovalResponse} />;
                  default:
                    return null;
                }
              })}
            </div>
          )
        )}
        {status === "submitted" ? <Loader2 className="size-4 animate-spin text-fg-faint" aria-label="Thinking" /> : null}
        {error ? (
          <p className="text-sm text-rose">{error.message.includes("429") ? "Too many requests — wait a minute." : "Something went wrong. Try again."}</p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="glass m-3 flex items-center gap-2 rounded-lg p-1.5"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about pricing, minimum spend or menus…"
          aria-label="Message the negotiator"
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        {busy ? (
          <Button type="button" variant="outline" size="icon" onClick={stop} aria-label="Stop" className="shrink-0 rounded-lg">
            <Square aria-hidden />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send" className="shrink-0 rounded-lg">
            <Send aria-hidden />
          </Button>
        )}
      </form>
    </div>
  );
}

function describe(part: ApprovalPart): { title: string; detail: string | null } {
  if (part.type === "tool-setMinimumSpend") {
    const amount = part.input?.min_spend_inr;
    return { title: `Set minimum spend to ${amount != null ? formatINR(amount) : "…"}`, detail: part.input?.reason ?? null };
  }
  const p = part.input;
  const diets = p?.dietary_tags?.filter(Boolean).map((d) => dietaryLabel(d!)).join(", ");
  return {
    title: `${p?.package_id ? "Update" : "Add"} package “${p?.name ?? "…"}” at ${p?.per_head_inr != null ? formatINR(p.per_head_inr) : "…"}/head${
      p?.is_active === false ? " (inactive)" : ""
    }`,
    detail: [diets ? `Covers: ${diets}` : null, p?.reason].filter(Boolean).join(" · ") || null,
  };
}

function ProposedChange({
  part,
  onRespond,
}: {
  part: ApprovalPart;
  onRespond: ChatAddToolApproveResponseFunction;
}) {
  const { title, detail } = describe(part);

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{title}</span>
        {part.state === "output-available" ? <Badge variant="success">Applied</Badge> : null}
        {part.state === "output-denied" ? <Badge variant="outline">Declined</Badge> : null}
        {part.state === "output-error" ? <Badge variant="destructive">Failed</Badge> : null}
        {part.state === "approval-responded" ? <Badge variant="secondary">{part.approval.approved ? "Applying…" : "Declined"}</Badge> : null}
      </div>
      {detail ? <p className="mt-1 text-xs text-fg-subtle">{detail}</p> : null}
      {part.state === "output-error" ? <p className="text-destructive mt-1 text-xs">{part.errorText}</p> : null}
      {part.state === "approval-requested" && !part.approval.isAutomatic ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => onRespond({ id: part.approval.id, approved: true })}>
            <Check aria-hidden /> Apply
          </Button>
          <Button size="sm" variant="outline" onClick={() => onRespond({ id: part.approval.id, approved: false, reason: "Host declined" })}>
            <X aria-hidden /> Decline
          </Button>
        </div>
      ) : null}
    </div>
  );
}
