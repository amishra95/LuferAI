"use client";

import { AlertTriangle, Ban, Check } from "lucide-react";

import { TOOL_META, toolName, toolPhase, toolResultSummary, type LuferToolPart } from "@/components/chat/tool-meta";
import { cn } from "@/lib/utils";

const PHASE_STYLE = {
  running: "border-copper-deep/30 bg-copper/[0.08]",
  done: "border-line bg-surface shadow-[0_1px_2px_rgb(9_9_11/0.04)] hover:border-line-strong",
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
        "inline-flex h-7 max-w-full items-center gap-2 rounded-full border pr-3 pl-1.5 text-left text-[12.5px] transition-colors",
        PHASE_STYLE[phase],
        selected && "ring-copper-deep/50 ring-1"
      )}
    >
      <span className="bg-surface-raised text-fg-subtle grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 font-mono text-[10px] leading-none tabular-nums">
        {String(step).padStart(2, "0")}
      </span>
      {phase === "running" ? (
        <span className="live-dot shrink-0" aria-hidden />
      ) : (
        <Icon className={cn("size-3.5 shrink-0", phase === "done" ? "text-fg-subtle" : "")} strokeWidth={1.75} aria-hidden />
      )}
      <span className={cn("truncate", phase === "running" ? "text-shimmer font-medium" : phase === "done" && "text-fg-muted")}>
        {phase === "running" && `${meta.running}…`}
        {phase === "done" && meta.done}
        {phase === "error" && `${meta.title} failed`}
        {phase === "denied" && `${meta.title} denied`}
      </span>
      {summary && <span className="text-fg-subtle hidden font-mono text-[11px] sm:inline">{summary}</span>}
      {phase === "done" && <Check className="text-sage size-3.5 shrink-0" strokeWidth={2.25} aria-label="done" />}
      {phase === "error" && <AlertTriangle className="size-3.5 shrink-0" aria-label="failed" />}
      {phase === "denied" && <Ban className="size-3.5 shrink-0" aria-label="denied" />}
    </button>
  );
}
