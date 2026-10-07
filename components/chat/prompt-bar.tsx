"use client";

import { useRef, useState } from "react";
import { ArrowUp, PanelRight, RotateCcw, Square } from "lucide-react";

import { cn } from "@/lib/utils";

const MAX_LENGTH = 4000;

export function PromptBar({
  busy,
  onSend,
  onStop,
  onNewChat,
  onToggleInspector,
  inspectorOpen,
  canReset,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onToggleInspector: () => void;
  inspectorOpen: boolean;
  canReset: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = value.trim();

  function submit() {
    if (!text || busy) return;
    onSend(text);
    setValue("");
    ref.current?.focus();
  }

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mx-auto max-w-3xl rounded-lg border border-zinc-800 bg-zinc-900 transition-colors focus-within:border-zinc-600"
      >
        <label htmlFor="prompt" className="sr-only">
          Message the agent
        </label>
        <textarea
          id="prompt"
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder="Ask about venues, bookings or platform metrics…"
          className="field-sizing-content block max-h-48 min-h-11 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button
            type="button"
            onClick={onNewChat}
            disabled={!canReset}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" aria-hidden /> New chat
          </button>
          <button
            type="button"
            onClick={onToggleInspector}
            aria-pressed={inspectorOpen}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100",
              inspectorOpen && "text-zinc-100"
            )}
          >
            <PanelRight className="size-3.5" aria-hidden /> Inspector
          </button>
          <span className="ml-auto hidden font-mono text-[11px] text-zinc-600 sm:inline">
            {value.length > MAX_LENGTH * 0.8 ? `${value.length}/${MAX_LENGTH}` : "⏎ send · ⇧⏎ newline"}
          </span>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="grid size-7 place-items-center rounded-md bg-zinc-100 text-zinc-900 transition-colors hover:bg-white"
            >
              <Square className="size-3 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text}
              aria-label="Send message"
              className="grid size-7 place-items-center rounded-md bg-zinc-100 text-zinc-900 transition-colors hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
