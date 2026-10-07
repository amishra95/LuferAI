"use client";

import { Bot } from "lucide-react";

import { Markdown } from "@/components/chat/markdown";
import { isLuferToolPart } from "@/components/chat/tool-meta";
import { ToolStatus } from "@/components/chat/tool-status";
import type { LuferUIMessage } from "@/types/chat";

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
        <div className="max-w-[85%] rounded-lg rounded-br-sm border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm whitespace-pre-wrap text-zinc-100">
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

  return (
    <div className="flex gap-3">
      <div className="grid size-7 shrink-0 place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400">
        <Bot className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5 text-sm leading-relaxed text-zinc-300">
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
                <ToolStatus
                  part={part}
                  step={steps[i]}
                  selected={selectedToolCallId === part.toolCallId}
                  onSelect={onSelectTool}
                />
              </div>
            );
          }
          return null;
        })}

        {streaming && message.parts.length === 0 && <ThinkingDots />}
        {message.metadata?.usage?.totalTokens != null && (
          <p className="font-mono text-[11px] text-zinc-600">
            {message.metadata.usage.totalTokens.toLocaleString("en-US")} tokens
          </p>
        )}
      </div>
    </div>
  );
}

export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant is thinking">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-pulse rounded-full bg-zinc-500" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
