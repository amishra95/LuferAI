"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, type ChatAddToolApproveResponseFunction } from "ai";
import { Check, CreditCard, Loader2, Send, Square, Wrench, X } from "lucide-react";

import { Markdown } from "@/components/chat/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openCheckout } from "@/lib/payments/open-checkout";
import { formatINR } from "@/lib/utils";
import type { ConciergeUIMessage } from "@/app/api/agent/chat/route";

const SUGGESTIONS = [
  "Plan a team dinner for Asha, Rahul, Meera and Dev next Friday in Indiranagar, 12 people, under ₹2,500 a head",
  "When are Priya, Karan and Neha all free on 2026-10-30 for a 2-hour lunch?",
  "Find a venue with a private dining room for 40 guests in Koramangala",
];

type Part = ConciergeUIMessage["parts"][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

const STATE_LABEL: Record<ToolPart["state"], string> = {
  "input-streaming": "Preparing…",
  "input-available": "Running…",
  "approval-requested": "Needs approval",
  "approval-responded": "Approval sent",
  "output-available": "Done",
  "output-error": "Failed",
  "output-denied": "Declined",
};

/**
 * Test harness for the LuferAI Concierge (/api/agent/chat): streams text, shows
 * each tool call with its input and output, and asks for approval before
 * createInvoiceAndPayment runs.
 */
export function ConciergeChat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, addToolApprovalResponse, status, stop, error } = useChat<ConciergeUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/agent/chat" }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const busy = status === "submitted" || status === "streaming";
  // Chosen by the server (GEMINI_MODEL); reported on each reply.
  const model = messages.findLast((m) => m.metadata?.model)?.metadata?.model;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-3xl flex-col">
      <header className="border-line border-b px-4 py-3">
        <h1 className="text-fg text-body font-medium">LuferAI Concierge · test</h1>
        <p className="text-fg-subtle text-caption">{model ?? "Gemini"} · up to 5 steps · team availability is mocked</p>
      </header>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="grid gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="border-line/60 bg-surface text-fg-muted hover:border-line-strong hover:text-fg min-h-11 rounded-lg border px-3 py-2 text-left text-body transition"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="bg-surface-raised text-fg ml-10 self-end rounded-lg rounded-br-md px-3.5 py-2 text-body whitespace-pre-wrap">
              {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
            </div>
          ) : (
            <div key={m.id} className="text-fg-muted grid gap-2 text-body leading-6">
              {m.parts.map((part, i) => {
                if (part.type === "text") return <Markdown key={i} text={part.text} />;
                if (part.type === "step-start") return i > 0 ? <hr key={i} className="border-line/50" /> : null;
                if (isToolUIPart(part)) return <ToolCall key={part.toolCallId} part={part as ToolPart} onRespond={addToolApprovalResponse} />;
                return null;
              })}
            </div>
          )
        )}
        {status === "submitted" ? <Loader2 className="text-fg-faint size-4 animate-spin" aria-label="Thinking" /> : null}
        {error ? <p className="text-rose text-body">{error.message.includes("429") ? "Too many requests — wait a minute." : error.message || "Something went wrong."}</p> : null}
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
          placeholder="Plan an event, find a venue, or pay a booking…"
          aria-label="Message the concierge"
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

function ToolCall({ part, onRespond }: { part: ToolPart; onRespond: ChatAddToolApproveResponseFunction }) {
  const name = getToolName(part);
  const running = part.state === "input-streaming" || part.state === "input-available" || (part.state === "approval-responded" && part.approval.approved);

  return (
    <div className="border-line bg-surface rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {running ? <Loader2 className="text-fg-subtle size-3.5 animate-spin" aria-hidden /> : <Wrench className="text-fg-subtle size-3.5" aria-hidden />}
        <span className="text-fg font-mono text-caption">{name}</span>
        <Badge variant={part.state === "output-error" ? "destructive" : part.state === "output-available" ? "success" : "outline"}>{STATE_LABEL[part.state]}</Badge>
      </div>

      {part.input !== undefined ? (
        <details className="mt-2">
          <summary className="text-fg-subtle cursor-pointer text-caption">Input</summary>
          <pre className="bg-surface-raised mt-1 overflow-x-auto rounded p-2 text-caption leading-4">{JSON.stringify(part.input, null, 2)}</pre>
        </details>
      ) : null}
      {part.state === "output-available" ? (
        <details className="mt-1">
          <summary className="text-fg-subtle cursor-pointer text-caption">Output</summary>
          <pre className="bg-surface-raised mt-1 max-h-72 overflow-auto rounded p-2 text-caption leading-4">{JSON.stringify(part.output, null, 2)}</pre>
        </details>
      ) : null}
      {part.state === "output-error" ? <p className="text-destructive mt-1 text-caption">{part.errorText}</p> : null}

      {part.state === "approval-requested" && !part.approval.isAutomatic ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" onClick={() => onRespond({ id: part.approval.id, approved: true })}>
            <Check aria-hidden /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onRespond({ id: part.approval.id, approved: false, reason: "User declined" })}>
            <X aria-hidden /> Decline
          </Button>
        </div>
      ) : null}

      {part.type === "tool-createInvoiceAndPayment" && part.state === "output-available" ? <PayAction output={part.output} /> : null}
    </div>
  );
}

function PayAction({ output }: { output: Extract<ToolPart, { type: "tool-createInvoiceAndPayment"; state: "output-available" }>["output"] }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!output.ok) return <p className="text-destructive mt-2 text-caption">{output.error}</p>;

  const pay = async () => {
    setPending(true);
    setMessage(null);
    try {
      await openCheckout(output.checkout, {
        description: output.kind === "deposit" ? "Event deposit · refunded if the venue declines" : "Contract instalment",
        onPaid: () => {
          setPending(false);
          setMessage("Payment submitted. Its status updates once the gateway confirms.");
        },
        onDismiss: () => setPending(false),
        onFailed: (m) => setMessage(m),
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not open checkout");
      setPending(false);
    }
  };

  return (
    <div className="mt-3 grid justify-items-start gap-1">
      <Button size="sm" variant="secondary" onClick={pay} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />}
        {output.amountInr != null ? `Pay ${formatINR(output.amountInr)}` : "Pay now"}
      </Button>
      {message ? <p className="text-fg-subtle text-caption">{message}</p> : null}
    </div>
  );
}
