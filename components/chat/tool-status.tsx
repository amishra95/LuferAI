"use client";

import { AlertTriangle, Ban, Check } from "lucide-react";

import { TOOL_META, toolName, toolPhase, toolResultSummary, type LuferToolPart } from "@/components/chat/tool-meta";
import { cn } from "@/lib/utils";

const PHASE_STYLE = {
  // Pending: a plum-light pill (light text via .on-plum) with a pulsing gold dot.
  running: "on-plum bg-plum-light border-plum-light",
  done: "border-line bg-surface hover:border-line-strong",
  error: "border-rose/25 bg-rose/[0.06] text-rose",
  denied: "border-line bg-surface text-fg-subtle",
} as const;

/** Live status pill for one tool call. Clicking it opens the call in the inspector. */
export function ToolStatus({
  part,
  step,
  selected,
  onSelect,
}: {
  part: LuferToolPart;
  step: number;
  selected: boolean;
  onSelect: (toolCallId: string) => void;
}) {
  const meta = TOOL_META[toolName(part)];
  const phase = toolPhase(part);
  const Icon = meta.icon;
  const summary = toolResultSummary(part);

  return (
    <button
      type="button"
      onClick={() => onSelect(part.toolCallId)}
      aria-pressed={selected}
      title="Inspect this call"
      className={cn(
        "inline-flex h-7 max-w-full min-w-0 items-center gap-2 rounded-badge border px-1.5 text-left text-caption font-medium leading-none transition-colors",
        PHASE_STYLE[phase],
        selected && "ring-focus ring-1"
      )}
    >
      <span className="bg-surface-raised text-fg-subtle rounded-badge inline-flex items-center px-2.5 py-0.5 font-mono text-caption leading-4 font-medium tabular-nums">
        {String(step).padStart(2, "0")}
      </span>
      {phase === "running" ? (
        <span className="status-dot bg-gold shrink-0 animate-pulse motion-reduce:animate-none" aria-hidden />
      ) : (
        <Icon className={cn("size-3.5 shrink-0", phase === "done" ? "text-fg-subtle" : "")} strokeWidth={1.75} aria-hidden />
      )}
      <span className={cn("truncate", phase === "running" ? "text-fg-subtle" : phase === "done" && "text-fg-muted")}>
        {phase === "running" && `${meta.running}…`}
        {phase === "done" && meta.done}
        {phase === "error" && `${meta.title} failed`}
        {phase === "denied" && `${meta.title} denied`}
      </span>
      {summary && <span className="text-fg-subtle hidden font-mono text-caption sm:inline">{summary}</span>}
      {/* Fixed-size trailing slot, so finishing a call doesn't change the pill's width. */}
      <span className="grid size-[18px] shrink-0 place-items-center">
        {phase === "done" && (
          <span className="badge-success grid size-[18px] place-items-center rounded-full">
            <Check className="size-3" strokeWidth={2.5} aria-label="done" />
          </span>
        )}
        {phase === "error" && <AlertTriangle className="size-3.5" aria-label="failed" />}
        {phase === "denied" && <Ban className="size-3.5" aria-label="denied" />}
      </span>
    </button>
  );
}
