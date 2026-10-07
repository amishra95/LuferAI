"use client";

import { AlertTriangle, Ban, Check, Loader2 } from "lucide-react";

import { TOOL_META, toolName, toolPhase, toolResultSummary, type LuferToolPart } from "@/components/chat/tool-meta";
import { cn } from "@/lib/utils";

const PHASE_STYLE = {
  running: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  done: "border-zinc-800 bg-zinc-900 text-zinc-300",
  error: "border-red-500/25 bg-red-500/10 text-red-300",
  denied: "border-amber-500/25 bg-amber-500/10 text-amber-300",
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
      className={cn(
        "group inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition-colors hover:border-zinc-600",
        PHASE_STYLE[phase],
        selected && "ring-1 ring-zinc-500"
      )}
    >
      <span className="font-mono text-[10px] text-zinc-500">STEP {step}</span>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {phase === "running" && `${meta.running}…`}
        {phase === "done" && meta.done}
        {phase === "error" && `${meta.title} failed`}
        {phase === "denied" && `${meta.title} denied`}
      </span>
      {summary && <span className="font-mono text-[11px] text-zinc-500">· {summary}</span>}
      {phase === "running" && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />}
      {phase === "done" && <Check className="size-3.5 shrink-0 text-emerald-400" aria-hidden />}
      {phase === "error" && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {phase === "denied" && <Ban className="size-3.5 shrink-0" aria-hidden />}
    </button>
  );
}
