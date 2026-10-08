"use client";

import { Markdown } from "@/components/chat/markdown";
import { isLuferToolPart } from "@/components/chat/tool-meta";
import { ToolStatus } from "@/components/chat/tool-status";
import type { LuferUIMessage } from "@/types/chat";

/** The agent's mark: a solid core in a hairline ring. */
export function AgentMark({ live = false }: { live?: boolean }) {
  return (
    <span aria-hidden className="border-line-strong bg-surface grid size-6 shrink-0 place-items-center rounded-full border">
      <span className={live ? "status-dot bg-sage" : "bg-fg size-1.5 rounded-full"} />
    </span>
  );
}

export function ChatMessage({
  message,
  streaming,
  selectedToolCallId,
  onSelectTool,
}: {
  message: LuferUIMessage;
  /** This is the assistant message currently receiving tokens. */
  streaming: boolean;
  selectedToolCallId: string | null;
  onSelectTool: (toolCallId: string) => void;
}) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="bg-surface border-line text-fg max-w-[85%] rounded-lg rounded-br-md border px-4 py-2.5 text-[14px] leading-6 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  // Step number each part belongs to (1-based), counted from the step-start markers.
  const steps: number[] = [];
  message.parts.reduce((n, p) => {
    const step = p.type === "step-start" ? n + 1 : n;
    steps.push(Math.max(step, 1));
    return step;
  }, 0);
  const lastPart = message.parts.at(-1);
  const tokens = message.metadata?.usage?.totalTokens;

  return (
    <div className="flex gap-3.5">
      <div className="pt-0.5">
        <AgentMark live={streaming} />
      </div>
      <div className="text-fg-muted min-w-0 flex-1 space-y-3 text-[14px] leading-7">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            const live = streaming && part === lastPart;
            return (
              <div key={i} className={live ? "streaming-caret" : undefined}>
                <Markdown text={part.text} />
              </div>
            );
          }
          if (isLuferToolPart(part)) {
            return (
              <div key={part.toolCallId}>
                <ToolStatus part={part} step={steps[i]} selected={selectedToolCallId === part.toolCallId} onSelect={onSelectTool} />
              </div>
            );
          }
          return null;
        })}

        {streaming && message.parts.length === 0 && <ThinkingDots />}
        {tokens != null && <p className="text-fg-subtle font-mono text-[11px] tabular-nums">{tokens.toLocaleString("en-US")} tokens</p>}
      </div>
    </div>
  );
}

export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-2" aria-label="Agent is thinking">
      {[0, 160, 320].map((d) => (
        <span key={d} className="bg-fg-faint size-1 animate-pulse rounded-full" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
