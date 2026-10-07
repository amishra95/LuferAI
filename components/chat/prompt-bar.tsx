"use client";

import { useRef, useState } from "react";
import { ArrowUp, PanelRight, Plus, Square } from "lucide-react";

import { cn } from "@/lib/utils";

const MAX_LENGTH = 4000;

/** Floating composer. Enter sends, Shift+Enter adds a line. */
export function PromptBar({
  busy,
  disabled = false,
  onSend,
  onStop,
  onNewChat,
  onToggleInspector,
  inspectorOpen,
  canReset,
}: {
  busy: boolean;
  /** No model configured: the composer can't send. */
  disabled?: boolean;
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
    if (!text || busy || disabled) return;
    onSend(text);
    setValue("");
    ref.current?.focus();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="border-line-strong bg-elevated/85 focus-within:border-copper-deep/50 focus-within:ring-[3px] focus-within:ring-copper/15 rounded-2xl border shadow-[0_1px_2px_rgb(9_9_11/0.05),0_16px_40px_-18px_rgb(9_9_11/0.22)] backdrop-blur-xl transition-colors"
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
        disabled={disabled}
        placeholder={disabled ? "Chat is unavailable until a model key is added in Settings" : "Ask about venues, bookings, spend or budgets…"}
        className="text-fg placeholder:text-fg-faint block field-sizing-content max-h-52 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-6 focus:outline-none"
      />
      <div className="flex items-center gap-0.5 px-2 pb-2">
        <button type="button" onClick={onNewChat} disabled={!canReset} className="btn btn-ghost h-7 rounded-lg px-2 text-[12px]">
          <Plus className="size-3.5" aria-hidden /> New
        </button>
        <button
          type="button"
          onClick={onToggleInspector}
          aria-pressed={inspectorOpen}
          className={cn("btn btn-ghost h-7 rounded-lg px-2 text-[12px]", inspectorOpen && "text-fg")}
        >
          <PanelRight className={cn("size-3.5", inspectorOpen && "text-copper-deep")} aria-hidden /> Inspector
        </button>
        <span className="text-fg-subtle ml-auto hidden pr-2 font-mono text-[10.5px] sm:inline">
          {value.length > MAX_LENGTH * 0.8 ? `${value.length}/${MAX_LENGTH}` : "↵ send  ⇧↵ newline"}
        </span>
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="border-copper-deep/30 bg-copper/10 text-copper-ink hover:bg-copper/15 grid size-8 place-items-center rounded-xl border transition-colors"
          >
            <Square className="size-2.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text || disabled}
            aria-label="Send message"
            className="bg-copper-deep hover:bg-copper-ink disabled:bg-surface-raised disabled:text-fg-faint grid size-8 place-items-center rounded-xl text-white shadow-[0_1px_2px_rgb(180_83_9/0.35)] transition-colors disabled:shadow-none"
          >
            <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
