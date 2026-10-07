import { CheckCircle2, CircleDashed, Loader2, XCircle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AgentTaskEvent, TaskStatus } from "@/types/telemetry";

const STATUS: Record<TaskStatus, { label: string; icon: LucideIcon; className: string; spin?: boolean }> = {
  running: { label: "Running", icon: Loader2, className: "text-sky-400 bg-sky-500/10 border-sky-500/20", spin: true },
  succeeded: { label: "Succeeded", icon: CheckCircle2, className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  failed: { label: "Failed", icon: XCircle, className: "text-red-400 bg-red-500/10 border-red-500/20" },
  queued: { label: "Queued", icon: CircleDashed, className: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatAgo(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { label, icon: Icon, className, spin } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium", className)}>
      <Icon className={cn("size-3", spin && "animate-spin")} aria-hidden />
      {label}
    </span>
  );
}

export function ActivityFeed({ events, now }: { events: AgentTaskEvent[]; now: Date }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950" aria-labelledby="activity-heading">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 id="activity-heading" className="text-sm font-medium text-zinc-100">
          Recent activity
        </h2>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
          </span>
          Live
        </span>
      </header>

      {/* Column headers, desktop only — rows reflow to stacked cards on mobile. */}
      <div className="hidden grid-cols-[7rem_minmax(0,1fr)_5rem_5rem_5rem_4.5rem] gap-3 border-b border-zinc-800 px-4 py-2 font-mono text-[11px] tracking-wider text-zinc-500 uppercase lg:grid">
        <span>Status</span>
        <span>Task</span>
        <span className="text-right">Step</span>
        <span className="text-right">Duration</span>
        <span className="text-right">Tokens</span>
        <span className="text-right">Started</span>
      </div>

      <ol className="divide-y divide-zinc-800/70">
        {events.map((e) => (
          <li
            key={e.id}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-zinc-900/60 lg:grid-cols-[7rem_minmax(0,1fr)_5rem_5rem_5rem_4.5rem] lg:items-center"
          >
            <div>
              <StatusBadge status={e.status} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-100">{e.task}</p>
              <p className="truncate font-mono text-xs text-zinc-500">
                <span className="text-zinc-400">{e.agent}</span>
                <span className="text-zinc-700"> · </span>
                {e.id}
                <span className="text-zinc-700"> · </span>
                <span className={cn(e.status === "failed" && "text-red-400/80")}>{e.log}</span>
              </p>
            </div>
            <div className="col-span-2 flex gap-4 font-mono text-xs text-zinc-400 tabular-nums lg:contents">
              <span className="lg:text-right">
                <span className="text-zinc-600 lg:hidden">step </span>
                {e.step}/{e.totalSteps}
              </span>
              <span className="lg:text-right">{formatDuration(e.durationMs)}</span>
              <span className="lg:text-right">
                {e.tokens.toLocaleString("en-US")}
                <span className="text-zinc-600 lg:hidden"> tok</span>
              </span>
              <time dateTime={e.startedAt} className="ml-auto text-zinc-500 lg:ml-0 lg:text-right">
                {formatAgo(e.startedAt, now)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
