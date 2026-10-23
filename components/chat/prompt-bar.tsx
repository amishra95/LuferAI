"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  initialValue = "",
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
  /** A draft to start from (e.g. /chat?prompt=…): shown in the composer, never sent on its own. */
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Unique per composer: the /chat page and the chat drawer can both be mounted.
  const id = useId();
  // Arriving with a draft: focus it with the caret at the end, ready to edit.
  useEffect(() => {
    const el = ref.current;
    if (!initialValue || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [initialValue]);
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
      className="border-line-strong bg-elevated focus-within:border-focus focus-within:ring-focus/25 rounded-lg border shadow-[var(--shadow-card)] transition-[border-color,box-shadow] focus-within:ring-[3px]"
    >
      <label htmlFor={id} className="sr-only">
        Message the agent
      </label>
      <textarea
        id={id}
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
        className="text-fg placeholder:text-fg-faint block field-sizing-content max-h-52 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-body leading-6 focus:outline-none"
      />
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <span className="text-fg-subtle hidden font-mono text-caption sm:inline">
          {value.length > MAX_LENGTH * 0.8 ? `${value.length}/${MAX_LENGTH}` : "↵ send  ⇧↵ newline"}
        </span>
        {/* Actions, right-aligned: new chat, inspector, then send / stop. */}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onNewChat} disabled={!canReset} className="btn btn-ghost h-8 px-2.5 text-caption">
            <Plus className="size-3.5" aria-hidden /> New
          </button>
          <button
            type="button"
            onClick={onToggleInspector}
            aria-pressed={inspectorOpen}
            className={cn("btn btn-ghost h-8 px-2.5 text-caption", inspectorOpen && "text-fg")}
          >
            <PanelRight className={cn("size-3.5", inspectorOpen && "text-fg")} aria-hidden /> Inspector
          </button>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="border-fg/30 bg-fg/10 text-fg hover:bg-fg/15 focus-visible:outline-focus grid size-8 place-items-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Square className="size-2.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text || disabled}
              aria-label="Send message"
              className="bg-coral text-on-coral hover:bg-coral-hover disabled:bg-surface-raised disabled:text-fg-faint focus-visible:outline-focus grid size-8 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
